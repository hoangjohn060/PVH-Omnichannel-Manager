import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Principal, PageRow } from './types';
import { boundedBody, decrypt, digest, encrypt, randomSecret, timingSafeEqual, validSignature } from './security';
import { Graph, GRAPH_VERSION, REQUIRED_PERMISSIONS } from './graph';
import { checkPage, logError, ownedPage, publicPage, saveCandidateToken, sendMessage } from './facebook';
import { persistWebhook, processEvents } from './webhook';
import { inbox, recoverInbox } from './inbox';
import { sheets, processSheets } from './sheets';
import { auth, employees, authenticate } from './auth';
export const app = new Hono<{ Bindings: Env; Variables: { principal: Principal } }>();
const numericId = z.string().regex(/^\d{1,40}$/);
const sendSchema = z.object({ requestId: z.uuid(), psid: numericId, text: z.string().trim().min(1).max(2000).optional(), attachment: z.object({ type: z.enum(['image', 'file']), url: z.url().max(2048).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }) }).strict().optional() }).strict().refine(value => Boolean(value.text) !== Boolean(value.attachment));
async function jsonBody(request: Request): Promise<unknown> { return JSON.parse(new TextDecoder().decode(await boundedBody(request, 16384))); }
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer'); c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  await next();
});
app.onError((error, c) => {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'INVALID_INPUT' }, 400);
  const safe = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'GATEWAY_OPERATION_FAILED';
  return c.json({ error: safe }, safe === 'BODY_TOO_LARGE' ? 413 : safe === 'PAGE_NOT_FOUND' ? 404 : 400);
});
app.get('/health', c => c.json({ service: 'pvh-gateway', phase: 6, graphVersion: GRAPH_VERSION }));
app.route('/auth', auth);
app.use('/api/*', async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization || !/^Bearer [a-f0-9]{64}$/.test(authorization)) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const principal = await authenticate(c.env, authorization.slice(7));
  if (!principal) return c.json({ error: 'UNAUTHORIZED' }, 401);
  c.set('principal', principal);
  await next();
});
app.route('/api/auth', employees);
app.route('/api/inbox', inbox);
app.route('/api/inbox/sheets', sheets);
app.use('/api/facebook/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.get('principal').role === 'viewer') return c.json({ error: 'FORBIDDEN' }, 403);
  await next();
});
app.use('/api/facebook/oauth/*', async (c, next) => {
  if (!['super_admin','admin'].includes(c.get('principal').role)) return c.json({ error: 'ADMIN_REQUIRED' }, 403);
  await next();
});
app.post('/api/facebook/oauth/start', async c => {
  const origin = new URL(c.env.PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== c.env.PUBLIC_ORIGIN || !/^\d+$/.test(c.env.META_APP_ID) || !c.env.META_APP_SECRET || !c.env.TOKEN_ENCRYPTION_KEY) return c.json({ error: 'META_CONFIGURATION_REQUIRED' }, 503);
  const principal = c.get('principal'); const now = Date.now();
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM fb_oauth WHERE org_id=? AND user_id=? AND status IN ('PENDING','EXCHANGING') AND expires_at>?").bind(principal.org_id, principal.user_id, now).first<{ count: number }>();
  if ((count?.count ?? 0) >= 3) return c.json({ error: 'TOO_MANY_TRANSACTIONS' }, 429);
  const state = randomSecret(); const id = crypto.randomUUID(); const expiresAt = now + 300000;
  await c.env.DB.prepare("INSERT INTO fb_oauth(id,state_hash,org_id,user_id,expires_at,status,created_at) VALUES(?,?,?,?,?,'PENDING',?)").bind(id, await digest(state), principal.org_id, principal.user_id, expiresAt, now).run();
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: c.env.META_APP_ID, redirect_uri: `${c.env.PUBLIC_ORIGIN}/meta/callback`, state, response_type: 'code', scope: REQUIRED_PERMISSIONS.join(','), auth_type: 'rerequest' }).toString();
  return c.json({ id, expiresAt, authorizationUrl: url.href });
});
app.get('/meta/callback', async c => {
  const state = c.req.query('state');
  if (!state || !/^[a-f0-9]{64}$/.test(state)) return c.text('INVALID_STATE', 400);
  const transaction = await c.env.DB.prepare("UPDATE fb_oauth SET status='EXCHANGING' WHERE state_hash=? AND status='PENDING' AND expires_at>? RETURNING id,org_id,user_id").bind(await digest(state), Date.now()).first<{ id: string; org_id: string; user_id: string }>();
  if (!transaction) return c.text('INVALID_OR_EXPIRED_STATE', 400);
  try {
    if (c.req.query('error')) throw new Error('OAUTH_DENIED');
    const code = z.string().min(1).max(4096).parse(c.req.query('code'));
    const graph = new Graph(c.env); const token = await graph.exchange(code);
    const permissions = await graph.inspect(token);
    if (!REQUIRED_PERMISSIONS.every(permission => permissions.includes(permission))) throw new Error('PERMISSION_DENIED');
    const pages = await graph.pages(token);
    const statements: D1PreparedStatement[] = [];
    for (const page of pages) {
      if (!numericId.safeParse(page.id).success || !page.access_token) continue;
      statements.push(c.env.DB.prepare('INSERT INTO fb_candidates(transaction_id,page_id,name,token,permissions,tasks) VALUES(?,?,?,?,?,?)').bind(transaction.id, page.id, page.name, await saveCandidateToken(c.env, transaction.id, page.id, page.access_token), JSON.stringify(permissions), JSON.stringify(page.tasks ?? [])));
    }
    // The whole candidate set must succeed before the desktop can select anything.
    for (let i = 0; i < statements.length; i += 80) await c.env.DB.batch(statements.slice(i, i + 80));
    await c.env.DB.prepare("UPDATE fb_oauth SET status='READY' WHERE id=? AND status='EXCHANGING' AND expires_at>?").bind(transaction.id, Date.now()).run();
    return c.text('Facebook authorization received. Return to PVH Omnichannel Manager to select a Page.');
  } catch (error) {
    const safe = await logError(c.env, transaction.org_id, null, error);
    await c.env.DB.batch([c.env.DB.prepare("UPDATE fb_oauth SET status='ERROR',error=? WHERE id=?").bind(safe, transaction.id), c.env.DB.prepare('DELETE FROM fb_candidates WHERE transaction_id=?').bind(transaction.id)]);
    return c.text('Facebook authorization failed. Return to PVH and check the error log.', 400);
  }
});
app.get('/api/facebook/oauth/:id', async c => {
  const principal = c.get('principal');
  const transaction = await c.env.DB.prepare('SELECT id,status,expires_at,error FROM fb_oauth WHERE id=? AND org_id=? AND user_id=?').bind(c.req.param('id'), principal.org_id, principal.user_id).first<{ id: string; status: string; expires_at: number; error: string | null }>();
  if (!transaction) return c.json({ error: 'TRANSACTION_NOT_FOUND' }, 404);
  const expired = transaction.expires_at <= Date.now();
  const candidates = !expired && transaction.status === 'READY' ? (await c.env.DB.prepare('SELECT page_id AS pageId,name,tasks FROM fb_candidates WHERE transaction_id=?').bind(transaction.id).all()).results : [];
  return c.json({ id: transaction.id, status: expired ? 'EXPIRED' : transaction.status, error: transaction.error, pages: candidates });
});
app.post('/api/facebook/oauth/:id/select', async c => {
  const { pageId } = z.object({ pageId: numericId }).strict().parse(await jsonBody(c.req.raw));
  const principal = c.get('principal'); const transactionId = c.req.param('id');
  const candidate = await c.env.DB.prepare("SELECT c.* FROM fb_candidates c JOIN fb_oauth t ON t.id=c.transaction_id WHERE t.id=? AND t.org_id=? AND t.user_id=? AND t.status='READY' AND t.expires_at>? AND c.page_id=?").bind(transactionId, principal.org_id, principal.user_id, Date.now(), pageId).first<{ name: string; token: string; permissions: string }>();
  if (!candidate) return c.json({ error: 'PAGE_NOT_AUTHORIZED' }, 403);
  const existing = await c.env.DB.prepare('SELECT id,org_id FROM fb_pages WHERE page_id=?').bind(pageId).first<{ id: string; org_id: string }>();
  if (existing && existing.org_id !== principal.org_id) return c.json({ error: 'PAGE_ALREADY_ASSIGNED' }, 409);
  const id = existing?.id ?? crypto.randomUUID();
  const token = await decrypt(c.env.TOKEN_ENCRYPTION_KEY, candidate.token, `candidate:${transactionId}:${pageId}`);
  const encrypted = await encrypt(c.env.TOKEN_ENCRYPTION_KEY, token, `page:${principal.org_id}:${pageId}`);
  await c.env.DB.prepare("INSERT INTO fb_pages(id,org_id,page_id,name,token,status,permissions,owner_id) VALUES(?,?,?,?,?,'CHECK_REQUIRED',?,?) ON CONFLICT(page_id) DO UPDATE SET name=excluded.name,token=excluded.token,status='CHECK_REQUIRED',permissions=excluded.permissions,owner_id=excluded.owner_id WHERE fb_pages.org_id=excluded.org_id").bind(id, principal.org_id, pageId, candidate.name, encrypted, candidate.permissions, principal.user_id).run();
  const page = await ownedPage(c.env, principal, id);
  await checkPage(c.env, page, true);
  await c.env.DB.prepare('DELETE FROM fb_candidates WHERE transaction_id=? AND page_id=?').bind(transactionId, pageId).run();
  return c.json(publicPage(await ownedPage(c.env, principal, id)));
});
app.get('/api/facebook/pages', async c => {
  const p = c.get('principal');
  const pages = await c.env.DB.prepare("SELECT * FROM fb_pages WHERE org_id=? AND (? IN ('admin','manager') OR EXISTS(SELECT 1 FROM inbox_grants g WHERE g.organization_id=fb_pages.org_id AND g.channel_id=fb_pages.id AND g.user_id=?)) ORDER BY name").bind(p.org_id,p.role,p.user_id).all<PageRow>();
  return c.json({ pages: pages.results.map(publicPage) });
});
app.post('/api/facebook/pages/:id/check', async c => {
  const page = await ownedPage(c.env, c.get('principal'), c.req.param('id'));
  await checkPage(c.env, page);
  return c.json(publicPage(await ownedPage(c.env, c.get('principal'), page.id)));
});
app.post('/api/facebook/pages/:id/disconnect', async c => {
  const principal = c.get('principal');
  if (principal.role !== 'admin') return c.json({ error: 'ADMIN_REQUIRED' }, 403);
  const page = await ownedPage(c.env, principal, c.req.param('id'));
  if (page.token) {
    try { await new Graph(c.env).call(`${page.page_id}/subscribed_apps`, await decrypt(c.env.TOKEN_ENCRYPTION_KEY, page.token, `page:${page.org_id}:${page.page_id}`), 'DELETE'); }
    catch (error) { await logError(c.env, principal.org_id, page.id, error); return c.json({ error: 'UNSUBSCRIBE_FAILED_RECONNECT_OR_REVOKE_IN_META' }, 409); }
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE fb_pages SET token=NULL,status='DISCONNECTED',webhook=0,checked_at=NULL WHERE id=?").bind(page.id),
    c.env.DB.prepare("DELETE FROM fb_candidates WHERE page_id=? AND transaction_id IN (SELECT id FROM fb_oauth WHERE org_id=?)").bind(page.page_id, principal.org_id),
  ]);
  return c.json({ status: 'DISCONNECTED' });
});
app.get('/api/facebook/pages/:id/threads', async c => {
  const page = await ownedPage(c.env, c.get('principal'), c.req.param('id'));
  return c.json({ threads: (await c.env.DB.prepare('SELECT psid,conversation_id AS conversationId,last_inbound AS lastInbound FROM fb_threads WHERE connection_id=? ORDER BY last_inbound DESC LIMIT 200').bind(page.id).all()).results });
});
app.get('/api/facebook/pages/:id/messages/:psid', async c => {
  const page = await ownedPage(c.env, c.get('principal'), c.req.param('id')); const psid = numericId.parse(c.req.param('psid'));
  return c.json({ messages: (await c.env.DB.prepare('SELECT message_id AS messageId,direction,text,attachments,timestamp,agent_id AS agentId,status FROM (SELECT * FROM fb_messages WHERE connection_id=? AND psid=? ORDER BY timestamp DESC LIMIT 200) ORDER BY timestamp').bind(page.id, psid).all()).results });
});
app.post('/api/facebook/pages/:id/send', async c => {
  const input = sendSchema.parse(await jsonBody(c.req.raw)); const principal = c.get('principal');
  return c.json(await sendMessage(c.env, principal, await ownedPage(c.env, principal, c.req.param('id')), input));
});
app.get('/api/facebook/logs', async c => {
  const p = c.get('principal');
  return c.json({ logs: (await c.env.DB.prepare("SELECT id,connection_id AS connectionId,code,subcode,trace,created_at AS createdAt FROM fb_logs WHERE org_id=? AND (? IN ('admin','manager') OR EXISTS(SELECT 1 FROM inbox_grants g WHERE g.organization_id=fb_logs.org_id AND g.channel_id=fb_logs.connection_id AND g.user_id=?)) ORDER BY id DESC LIMIT 100").bind(p.org_id,p.role,p.user_id).all()).results });
});
app.post('/api/facebook/events/:key/replay', async c => {
  const principal = c.get('principal'); if (principal.role !== 'admin') return c.json({ error: 'ADMIN_REQUIRED' }, 403);
  const key = z.string().regex(/^[a-f0-9]{64}$/).parse(c.req.param('key'));
  const result = await c.env.DB.prepare("UPDATE fb_events SET status='PENDING',attempts=0,next_attempt=0,error=NULL WHERE event_key=? AND org_id=? AND status='DEAD'").bind(key, principal.org_id).run();
  return c.json({ replayed: result.meta.changes === 1 });
});
app.get('/meta/webhook', async c => {
  if (c.req.query('hub.mode') !== 'subscribe' || !c.env.META_VERIFY_TOKEN || !await timingSafeEqual(c.req.query('hub.verify_token') ?? '', c.env.META_VERIFY_TOKEN)) return c.text('FORBIDDEN', 403);
  return c.text(z.string().min(1).max(256).parse(c.req.query('hub.challenge')));
});
app.post('/meta/webhook', async c => {
  const raw = await boundedBody(c.req.raw);
  if (!c.env.META_APP_SECRET || !await validSignature(c.env.META_APP_SECRET, raw, c.req.header('X-Hub-Signature-256') ?? null)) return c.text('INVALID_SIGNATURE', 403);
  await persistWebhook(c.env, JSON.parse(new TextDecoder().decode(raw)));
  c.executionCtx.waitUntil(processEvents(c.env));
  return c.text('EVENT_RECEIVED');
});
export async function maintenance(env: Env): Promise<void> {
  await recoverInbox(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM employee_sessions WHERE expires_at<? OR (revoked=1 AND created_at<?)').bind(Date.now(),Date.now()-7*86400000),
    env.DB.prepare('DELETE FROM auth_limits WHERE window<?').bind(Math.floor(Date.now()/900000)-2),
    env.DB.prepare("UPDATE fb_outbound SET status='UNKNOWN',error='INTERRUPTED_SEND',updated_at=? WHERE status='SENDING' AND updated_at<?").bind(Date.now(), Date.now() - 60000),
    env.DB.prepare('DELETE FROM fb_candidates WHERE transaction_id IN (SELECT id FROM fb_oauth WHERE expires_at<=?)').bind(Date.now()),
    env.DB.prepare("UPDATE fb_oauth SET status='EXPIRED' WHERE expires_at<=? AND status IN ('PENDING','EXCHANGING','READY')").bind(Date.now()),
    env.DB.prepare('DELETE FROM fb_oauth WHERE created_at<?').bind(Date.now() - 86400000),
    env.DB.prepare("DELETE FROM fb_events WHERE status='PROCESSED' AND received_at<?").bind(Date.now() - 7 * 86400000),
    env.DB.prepare('DELETE FROM fb_logs WHERE created_at<?').bind(Date.now() - 30 * 86400000),
  ]);
  await processEvents(env);
  await processSheets(env);
}
export default { fetch: app.fetch, scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext): void => { ctx.waitUntil(maintenance(env)); } };
