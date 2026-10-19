import { Graph, GraphError, REQUIRED_PERMISSIONS, WEBHOOK_FIELDS } from './graph';
import { decrypt, digest, encrypt } from './security';
import type { Env, PageRow, Principal } from './types';
export async function ownedPage(env: Env, principal: Principal, id: string): Promise<PageRow> {
  const page = await env.DB.prepare('SELECT * FROM fb_pages WHERE id=? AND org_id=?').bind(id, principal.org_id).first<PageRow>();
  if (!page) throw new Error('PAGE_NOT_FOUND');
  if (!['admin','manager'].includes(principal.role) && !await env.DB.prepare('SELECT 1 FROM inbox_grants WHERE organization_id=? AND channel_id=? AND user_id=?').bind(principal.org_id,id,principal.user_id).first()) throw new Error('PAGE_NOT_FOUND');
  return page;
}
export async function logError(env: Env, org: string, connection: string | null, error: unknown): Promise<string> {
  const code = error instanceof GraphError ? error.message : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'GATEWAY_OPERATION_FAILED';
  await env.DB.prepare('INSERT INTO fb_logs(org_id,connection_id,code,subcode,trace,created_at) VALUES(?,?,?,?,?,?)').bind(org, connection, code, error instanceof GraphError ? error.subcode : null, error instanceof GraphError ? error.trace : null, Date.now()).run();
  if (connection && error instanceof GraphError && (error.code === 190 || error.code === 10 || error.code === 200)) {
    await env.DB.prepare('UPDATE fb_pages SET status=?,error=?,webhook=0 WHERE id=? AND org_id=?').bind(error.code === 190 ? 'TOKEN_REVOKED' : 'PERMISSION_DENIED', code, connection, org).run();
  }
  return code;
}
export function publicPage(page: PageRow) {
  return { id: page.id, pageId: page.page_id, name: page.name, status: page.checked_at && page.checked_at > Date.now() - 300000 ? page.status : page.status === 'CONNECTED' ? 'CHECK_REQUIRED' : page.status, permissions: JSON.parse(page.permissions) as string[], webhook: Boolean(page.webhook), checkedAt: page.checked_at, error: page.error };
}
export async function checkPage(env: Env, page: PageRow, subscribe = false, graph = new Graph(env)): Promise<void> {
  if (!page.token) throw new Error('PAGE_DISCONNECTED');
  const token = await decrypt(env.TOKEN_ENCRYPTION_KEY, page.token, `page:${page.org_id}:${page.page_id}`);
  try {
    const permissions = await graph.inspect(token, page.page_id);
    if (!REQUIRED_PERMISSIONS.every(permission => permissions.includes(permission))) throw new GraphError(200, null, null);
    const identity = await graph.call<{ id: string }>('me', token, 'GET', { fields: 'id' });
    if (identity.id !== page.page_id) throw new Error('TOKEN_PAGE_MISMATCH');
    if (subscribe) {
      const result = await graph.call<{ success: boolean }>(`${page.page_id}/subscribed_apps`, token, 'POST', { subscribed_fields: WEBHOOK_FIELDS.join(',') });
      if (!result.success) throw new Error('SUBSCRIPTION_FAILED');
    }
    const apps = await graph.call<{ data: { id: string; subscribed_fields?: string[] }[] }>(`${page.page_id}/subscribed_apps`, token);
    const app = apps.data.find(item => item.id === env.META_APP_ID);
    const subscribed = WEBHOOK_FIELDS.every(field => app?.subscribed_fields?.includes(field));
    const updated = await env.DB.prepare('UPDATE fb_pages SET permissions=?,webhook=?,status=?,checked_at=?,error=NULL WHERE id=? AND token=?').bind(JSON.stringify(permissions), subscribed ? 1 : 0, subscribed ? 'CONNECTED' : 'WEBHOOK_MISSING', Date.now(), page.id, page.token).run();
    if (!updated.meta.changes) throw new Error('CONNECTION_CHANGED');
    if (!subscribed) throw new Error('WEBHOOK_MISSING');
  } catch (error) {
    await env.DB.prepare("UPDATE fb_pages SET status='ERROR',webhook=0,checked_at=? WHERE id=?").bind(Date.now(), page.id).run();
    const code = await logError(env, page.org_id, page.id, error);
    await env.DB.prepare('UPDATE fb_pages SET error=? WHERE id=?').bind(code, page.id).run();
    throw error;
  }
}
export interface SendInput { requestId: string; psid: string; text?: string; attachment?: { type: 'image' | 'file'; url: string } }
export function withinWindow(lastInbound: number, now = Date.now()): boolean { return lastInbound > 0 && lastInbound <= now && now - lastInbound < 86400000; }
export async function sendMessage(env: Env, principal: Principal, page: PageRow, input: SendInput, graph = new Graph(env)): Promise<{status:string;messageId:string|null;error?:string|null}> {
  if (principal.role === 'viewer') throw new Error('FORBIDDEN');
  const contentHash = await digest(JSON.stringify({ psid: input.psid, text: input.text ?? null, attachment: input.attachment ?? null }));
  const previous = await env.DB.prepare('SELECT * FROM fb_outbound WHERE request_id=?').bind(input.requestId).first<{ org_id: string; connection_id: string; agent_id: string; content_hash: string; status: string; message_id: string | null; error: string | null }>();
  if (previous) {
    if (previous.org_id !== principal.org_id || previous.connection_id !== page.id || previous.agent_id !== principal.user_id || previous.content_hash !== contentHash) throw new Error('REQUEST_ID_CONFLICT');
    return { status: previous.status, messageId: previous.message_id, error: previous.error };
  }
  await checkPage(env, page, false, graph);
  const thread = await env.DB.prepare('SELECT last_inbound FROM fb_threads WHERE connection_id=? AND psid=?').bind(page.id, input.psid).first<{ last_inbound: number }>();
  if (!thread || !withinWindow(thread.last_inbound)) throw new Error('MESSAGING_WINDOW_CLOSED');
  const now = Date.now();
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO fb_outbound(request_id,org_id,connection_id,psid,agent_id,content_hash,payload,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'SENDING',?,?)").bind(input.requestId, principal.org_id, page.id, input.psid, principal.user_id, contentHash, JSON.stringify(input), now, now).run();
  if (!claimed.meta.changes) throw new Error('REQUEST_ALREADY_CLAIMED');
  let accepted = false;
  try {
    const active = await env.DB.prepare("SELECT token,status FROM fb_pages WHERE id=? AND org_id=?").bind(page.id, principal.org_id).first<{ token: string | null; status: string }>();
    if (!active || active.status !== 'CONNECTED' || active.token !== page.token) throw new Error('CONNECTION_CHANGED');
    if (!withinWindow(thread.last_inbound)) throw new Error('MESSAGING_WINDOW_CLOSED');
    const token = await decrypt(env.TOKEN_ENCRYPTION_KEY, page.token!, `page:${page.org_id}:${page.page_id}`);
    const message = input.attachment ? { attachment: { type: input.attachment.type, payload: { url: input.attachment.url, is_reusable: false } } } : { text: input.text };
    const result = await graph.call<{ message_id?: string; recipient_id?: string }>(`${page.page_id}/messages`, token, 'POST', { recipient: { id: input.psid }, messaging_type: 'RESPONSE', message });
    accepted = true;
    if (!result.message_id || result.recipient_id !== input.psid) throw new Error('SEND_RESULT_UNKNOWN');
    await env.DB.batch([
      env.DB.prepare("UPDATE fb_outbound SET status='ACCEPTED',message_id=?,updated_at=? WHERE request_id=?").bind(result.message_id, Date.now(), input.requestId),
      env.DB.prepare("INSERT INTO fb_messages(connection_id,message_id,psid,direction,text,attachments,timestamp,agent_id,status) VALUES(?,?,?,'outgoing',?,?,?,?,'ACCEPTED') ON CONFLICT(connection_id,message_id) DO UPDATE SET agent_id=excluded.agent_id").bind(page.id, result.message_id, input.psid, input.text ?? '', JSON.stringify(input.attachment ? [input.attachment] : []), now, principal.user_id),
      env.DB.prepare("UPDATE fb_messages SET status='DELIVERED' WHERE connection_id=? AND message_id=? AND status!='READ' AND EXISTS(SELECT 1 FROM fb_receipts r WHERE r.connection_id=fb_messages.connection_id AND r.psid=fb_messages.psid AND r.message_id=fb_messages.message_id)").bind(page.id, result.message_id),
      env.DB.prepare("UPDATE fb_messages SET status='READ' WHERE connection_id=? AND message_id=? AND timestamp<=(SELECT watermark FROM fb_read_watermarks WHERE connection_id=? AND psid=?)").bind(page.id, result.message_id, page.id, input.psid),
    ]);
    return { status: 'ACCEPTED', messageId: result.message_id };
  } catch (error) {
    const code = await logError(env, principal.org_id, page.id, error);
    const status = !accepted && error instanceof GraphError && !error.transient && error.code < 500 ? 'FAILED' : 'UNKNOWN';
    await env.DB.prepare('UPDATE fb_outbound SET status=?,error=?,updated_at=? WHERE request_id=?').bind(status, code, Date.now(), input.requestId).run();
    return { status, messageId: null, error: code };
  }
}
export async function saveCandidateToken(env: Env, transaction: string, pageId: string, token: string): Promise<string> {
  return encrypt(env.TOKEN_ENCRYPTION_KEY, token, `candidate:${transaction}:${pageId}`);
}