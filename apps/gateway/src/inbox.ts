import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Principal } from './types';
import { boundedBody, digest } from './security';
import { ownedPage, sendMessage } from './facebook';
import { requireLease } from './lease';
import type { InboxChannel, InboxConversation, InboxMessage } from '../../../packages/shared/types/inbox';

type Bindings = { Bindings: Env; Variables: { principal: Principal } };
export const inbox = new Hono<Bindings>();
const id = z.string().min(1).max(180);
const text = z.string().trim().min(1).max(5000);
const status = z.enum(['OPEN', 'PENDING', 'RESOLVED']);
const manager = (p: Principal): boolean => ['super_admin','admin','manager'].includes(p.role);
const writer = (p: Principal): void => { if (p.role === 'viewer') throw new Error('FORBIDDEN'); };
async function body(request: Request): Promise<unknown> { return JSON.parse(new TextDecoder().decode(await boundedBody(request, 32768))); }
export async function channelAccess(env: Env, p: Principal, channelId: string): Promise<InboxChannel> {
  const row = await env.DB.prepare(`SELECT c.* FROM channel_connections c WHERE c.id=? AND c.organization_id=? AND
    (? IN ('super_admin','admin','manager') OR EXISTS(SELECT 1 FROM inbox_grants g WHERE g.organization_id=c.organization_id AND g.channel_id=c.id AND g.user_id=?))`)
    .bind(channelId, p.org_id, p.role, p.user_id).first<InboxChannel>();
  if (!row) throw new Error('INBOX_NOT_FOUND');
  return row;
}
const conversationSelect = `SELECT c.*,cu.name,cu.avatar,ch.platform,ch.name AS channel_name,u.name AS agent_name,
 (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.organization_id=c.organization_id AND m.direction='incoming' AND m.received_at>COALESCE((SELECT read_at FROM inbox_reads r WHERE r.organization_id=c.organization_id AND r.conversation_id=c.id AND r.user_id=?),0)) AS unread
 FROM conversations c JOIN customers cu ON cu.id=c.customer_id AND cu.organization_id=c.organization_id
 JOIN channel_connections ch ON ch.id=c.channel_id AND ch.organization_id=c.organization_id
 LEFT JOIN users u ON u.organization_id=c.organization_id AND u.id=c.assigned_user_id`;
async function conversation(env: Env, p: Principal, conversationId: string): Promise<InboxConversation> {
  const row = await env.DB.prepare(`${conversationSelect} WHERE c.id=? AND c.organization_id=?`).bind(p.user_id, conversationId, p.org_id).first<InboxConversation>();
  if (!row) throw new Error('INBOX_NOT_FOUND');
  await channelAccess(env, p, row.channel_id); return row;
}
function audit(env: Env, p: Principal, action: string, target: string, detail = ''): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO inbox_audit(organization_id,actor_id,action,target_id,detail,created_at) VALUES(?,?,?,?,?,?)').bind(p.org_id, p.user_id, action, target, detail, Date.now());
}
function change(env: Env, p: Principal, c: InboxConversation): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO inbox_changes(organization_id,channel_id,conversation_id,created_at) VALUES(?,?,?,?)').bind(p.org_id, c.channel_id, c.id, Date.now());
}
const cursorSchema = z.object({ time: z.number().int().nonnegative(), id }).strict();
function decodeCursor(value: string | undefined): { time: number; id: string } {
  return value ? cursorSchema.parse(JSON.parse(atob(value))) : { time: Number.MAX_SAFE_INTEGER, id: '\uffff' };
}
function cursor(row: { id: string }, time: number): string { return btoa(JSON.stringify({ time, id: row.id })); }
inbox.onError((error, c) => {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : error instanceof z.ZodError || error instanceof SyntaxError ? 'INVALID_INPUT' : 'INBOX_OPERATION_FAILED';
  return c.json({ error: code }, code === 'FORBIDDEN' ? 403 : code === 'INBOX_NOT_FOUND' ? 404 : ['VERSION_CONFLICT','REQUEST_ID_CONFLICT','SEND_IN_PROGRESS'].includes(code) ? 409 : 400);
});
inbox.get('/session', async c => {
  const p = c.get('principal');
  const channels = await c.env.DB.prepare(`SELECT c.* FROM channel_connections c WHERE c.organization_id=? AND (? IN ('super_admin','admin','manager') OR EXISTS(SELECT 1 FROM inbox_grants g WHERE g.organization_id=c.organization_id AND g.channel_id=c.id AND g.user_id=?)) ORDER BY c.name`).bind(p.org_id, p.role, p.user_id).all();
  const members = await c.env.DB.prepare('SELECT m.user_id,m.role,m.active,u.name FROM memberships m JOIN users u ON u.organization_id=m.organization_id AND u.id=m.user_id WHERE m.organization_id=? ORDER BY u.name').bind(p.org_id).all();
  return c.json({ principal: p, channels: channels.results, members: members.results });
});
inbox.post('/members', async c => {
  const p = c.get('principal'); if (!['super_admin','admin'].includes(p.role)) throw new Error('FORBIDDEN');
  const input = z.object({ userId: id, name: z.string().trim().min(1).max(100), role: z.enum(['super_admin','admin','manager','agent','viewer']), active: z.boolean() }).strict().parse(await body(c.req.raw));
  if (input.userId === p.user_id && (!input.active || input.role !== p.role)) throw new Error('CANNOT_DEMOTE_SELF');
  const previous=await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id=? AND user_id=?').bind(p.org_id,input.userId).first<{role:string}>();
  if(p.role!=='super_admin'&&(input.role==='super_admin'||previous?.role==='super_admin'))throw new Error('FORBIDDEN');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users VALUES(?,?,?) ON CONFLICT(organization_id,id) DO UPDATE SET name=excluded.name').bind(p.org_id, input.userId, input.name),
    c.env.DB.prepare('INSERT INTO memberships VALUES(?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,active=excluded.active').bind(p.org_id, input.userId, input.role, Number(input.active)),
    audit(c.env, p, 'MEMBERSHIP_UPDATE', input.userId, JSON.stringify(input)),
  ]); return c.json({ saved: true });
});
inbox.post('/grants', async c => {
  const p = c.get('principal'); if (!manager(p)) throw new Error('FORBIDDEN');
  const input = z.object({ channelId: id, userId: id, allowed: z.boolean() }).strict().parse(await body(c.req.raw));
  await channelAccess(c.env, p, input.channelId);
  if (!await c.env.DB.prepare('SELECT 1 FROM memberships WHERE organization_id=? AND user_id=? AND active=1').bind(p.org_id, input.userId).first()) throw new Error('MEMBER_NOT_FOUND');
  await c.env.DB.batch([input.allowed
    ? c.env.DB.prepare('INSERT OR IGNORE INTO inbox_grants VALUES(?,?,?)').bind(p.org_id, input.channelId, input.userId)
    : c.env.DB.prepare('DELETE FROM inbox_grants WHERE organization_id=? AND channel_id=? AND user_id=?').bind(p.org_id, input.channelId, input.userId), audit(c.env, p, 'INBOX_GRANT', input.channelId, JSON.stringify(input))]);
  return c.json({ saved: true });
});
inbox.get('/grants', async c => {
  const p = c.get('principal'); if (!manager(p)) throw new Error('FORBIDDEN');
  return c.json({ grants: (await c.env.DB.prepare('SELECT channel_id,user_id FROM inbox_grants WHERE organization_id=?').bind(p.org_id).all()).results });
});
inbox.get('/conversations', async c => {
  const p = c.get('principal'); const page = decodeCursor(c.req.query('before')); const q = z.string().max(200).parse(c.req.query('q') ?? '');
  const platform = z.enum(['','zalo','facebook']).parse(c.req.query('platform') ?? '');
  const channelId = c.req.query('channel') ?? ''; if (channelId) await channelAccess(c.env, p, channelId);
  const rows = (await c.env.DB.prepare(`${conversationSelect} WHERE c.organization_id=?
    AND (? IN ('super_admin','admin','manager') OR EXISTS(SELECT 1 FROM inbox_grants g WHERE g.organization_id=c.organization_id AND g.channel_id=c.channel_id AND g.user_id=?))
    AND (?='' OR ch.platform=?) AND (?='' OR c.channel_id=?)
    AND (?='' OR instr(lower(cu.name),lower(?))>0 OR EXISTS(SELECT 1 FROM messages m WHERE m.organization_id=c.organization_id AND m.conversation_id=c.id AND instr(lower(m.content),lower(?))>0))
    AND (c.updated_at<? OR (c.updated_at=? AND c.id<?)) ORDER BY c.updated_at DESC,c.id DESC LIMIT 51`)
    .bind(p.user_id,p.org_id,p.role,p.user_id,platform,platform,channelId,channelId,q,q,q,page.time,page.time,page.id).all<InboxConversation>()).results;
  const items = rows.slice(0,50); const last = items.at(-1); return c.json({ items, next: rows.length > 50 && last ? cursor(last,last.updated_at) : null });
});
inbox.get('/changes', async c => {
  const p = c.get('principal'); const channelId = id.parse(c.req.query('channel')); await channelAccess(c.env, p, channelId);
  const after = z.coerce.number().int().nonnegative().safe().parse(c.req.query('after') ?? 0);
  const rows = (await c.env.DB.prepare('SELECT seq,conversation_id FROM inbox_changes WHERE organization_id=? AND channel_id=? AND seq>? ORDER BY seq LIMIT 101').bind(p.org_id,channelId,after).all<{ seq: number; conversation_id: string }>()).results;
  const items = rows.slice(0,100); return c.json({ items, cursor: items.at(-1)?.seq ?? after, more: rows.length>100 });
});
inbox.get('/conversations/:id', async c => {
  const p = c.get('principal'); const row = await conversation(c.env,p,c.req.param('id')); const page = decodeCursor(c.req.query('before'));
  const messages = (await c.env.DB.prepare(`SELECT m.*,COALESCE((SELECT json_group_array(json(a.metadata)) FROM attachments a WHERE a.message_id=m.id),'[]') AS attachments FROM messages m
    WHERE organization_id=? AND conversation_id=? AND (source_created_at<? OR (source_created_at=? AND id<?)) ORDER BY source_created_at DESC,id DESC LIMIT 51`).bind(p.org_id,row.id,page.time,page.time,page.id).all<InboxMessage>()).results;
  const items = messages.slice(0,50); const last=items.at(-1);
  const customer = await c.env.DB.prepare('SELECT id,name,tags,care_notes,created_at,updated_at,version FROM customers WHERE id=? AND organization_id=?').bind(row.customer_id,p.org_id).first();
  const notes = (await c.env.DB.prepare('SELECT * FROM internal_notes WHERE organization_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 50').bind(p.org_id,row.id).all()).results;
  const history = (await c.env.DB.prepare('SELECT id,status,created_at FROM conversations WHERE organization_id=? AND customer_id=? AND channel_id=? ORDER BY created_at DESC LIMIT 50').bind(p.org_id,row.customer_id,row.channel_id).all()).results;
  const stats = await c.env.DB.prepare(`SELECT SUM(direction='incoming') AS incoming,SUM(direction='outgoing') AS outgoing,
    (SELECT MIN(source_created_at) FROM messages WHERE organization_id=? AND conversation_id=? AND direction='outgoing' AND attribution_status='verified' AND send_status IN ('SENT','ACCEPTED','DELIVERED','READ','SEEN')) - MIN(CASE WHEN direction='incoming' THEN source_created_at END) AS first_response_ms FROM messages WHERE organization_id=? AND conversation_id=?`).bind(p.org_id,row.id,p.org_id,row.id).first();
  const draft = await c.env.DB.prepare('SELECT content FROM inbox_drafts WHERE organization_id=? AND conversation_id=? AND user_id=?').bind(p.org_id,row.id,p.user_id).first<{ content: string }>();
  await audit(c.env,p,'CUSTOMER_DATA_READ',row.id).run();
  return c.json({ conversation: row,customer,messages: items.reverse(),next: messages.length>50 && last ? cursor(last,last.source_created_at) : null,notes,history,stats,draft: draft?.content ?? '' });
});
inbox.post('/conversations/:id/update', async c => {
  const p=c.get('principal'); writer(p); const row=await conversation(c.env,p,c.req.param('id'));
  const input=z.object({ version:z.number().int().nonnegative(),status,assignedUserId:id.nullable() }).strict().parse(await body(c.req.raw));
  if (input.assignedUserId) {
    const member=await c.env.DB.prepare("SELECT role FROM memberships WHERE organization_id=? AND user_id=? AND active=1 AND role!='viewer'").bind(p.org_id,input.assignedUserId).first<{role:Principal['role']}>();
    if (!member) throw new Error('MEMBER_NOT_FOUND');
    await channelAccess(c.env,{org_id:p.org_id,user_id:input.assignedUserId,role:member.role},row.channel_id);
  }
  // D1 batches are atomic; conditional history/audit precede the CAS update.
  const condition='EXISTS(SELECT 1 FROM conversations WHERE id=? AND organization_id=? AND version=?)';
  const results=await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO conversation_assignments SELECT ?,?,?,?,?,? WHERE ${condition}`).bind(crypto.randomUUID(),p.org_id,row.id,input.assignedUserId,p.user_id,Date.now(),row.id,p.org_id,input.version),
    c.env.DB.prepare(`INSERT INTO inbox_audit(organization_id,actor_id,action,target_id,detail,created_at) SELECT ?,?,'CONVERSATION_UPDATE',?,?,? WHERE ${condition}`).bind(p.org_id,p.user_id,row.id,JSON.stringify(input),Date.now(),row.id,p.org_id,input.version),
    c.env.DB.prepare('UPDATE conversations SET status=?,assigned_user_id=?,version=version+1 WHERE id=? AND organization_id=? AND version=?').bind(input.status,input.assignedUserId,row.id,p.org_id,input.version),
    change(c.env,p,row),
  ]);
  if (!results[2]?.meta.changes) throw new Error('VERSION_CONFLICT'); return c.json({ saved:true });
});
inbox.post('/conversations/:id/draft', async c => {
  const p=c.get('principal'); writer(p); const row=await conversation(c.env,p,c.req.param('id')); const input=z.object({content:z.string().max(5000)}).strict().parse(await body(c.req.raw));
  await c.env.DB.prepare('INSERT INTO inbox_drafts VALUES(?,?,?,?,?) ON CONFLICT(organization_id,conversation_id,user_id) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at').bind(p.org_id,row.id,p.user_id,input.content,Date.now()).run(); return c.json({saved:true});
});
inbox.post('/conversations/:id/read', async c => {
  const p=c.get('principal'); const row=await conversation(c.env,p,c.req.param('id'));
  const input=z.object({ through:z.number().int().nonnegative().max(Date.now()) }).strict().parse(await body(c.req.raw));
  await c.env.DB.prepare('INSERT INTO inbox_reads VALUES(?,?,?,?) ON CONFLICT(organization_id,conversation_id,user_id) DO UPDATE SET read_at=MAX(read_at,excluded.read_at)').bind(p.org_id,row.id,p.user_id,input.through).run(); return c.json({saved:true});
});
inbox.post('/conversations/:id/notes', async c => {
  const p=c.get('principal'); writer(p); const row=await conversation(c.env,p,c.req.param('id')); const input=z.object({content:text}).strict().parse(await body(c.req.raw));
  await c.env.DB.batch([c.env.DB.prepare('INSERT INTO internal_notes VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),p.org_id,row.id,p.user_id,input.content,Date.now()),audit(c.env,p,'NOTE_ADD',row.id),change(c.env,p,row)]); return c.json({saved:true});
});
inbox.post('/conversations/:id/customer', async c => {
  const p=c.get('principal'); writer(p); const row=await conversation(c.env,p,c.req.param('id'));
  const input=z.object({version:z.number().int().nonnegative(),tags:z.array(z.string().trim().min(1).max(40)).max(30),careNotes:z.string().max(5000)}).strict().parse(await body(c.req.raw));
  const results=await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO inbox_audit(organization_id,actor_id,action,target_id,detail,created_at) SELECT ?,?,'CUSTOMER_UPDATE',?,'',? WHERE EXISTS(SELECT 1 FROM customers WHERE id=? AND organization_id=? AND version=?)").bind(p.org_id,p.user_id,row.customer_id,Date.now(),row.customer_id,p.org_id,input.version),
    c.env.DB.prepare('UPDATE customers SET tags=?,care_notes=?,version=version+1 WHERE id=? AND organization_id=? AND version=?').bind(JSON.stringify([...new Set(input.tags)]),input.careNotes,row.customer_id,p.org_id,input.version),change(c.env,p,row),
  ]);
  if (!results[1]?.meta.changes) throw new Error('VERSION_CONFLICT'); return c.json({saved:true});
});

interface SendJob { id:string; organization_id:string; channel_id:string; conversation_id:string; message_id:string; agent_id:string; content_hash:string; status:string; attempts:number }
export async function finishJob(env:Env, job:SendJob, result:{status:string;messageId:string|null;error?:string|null}):Promise<void> {
  const now=Date.now();
  await env.DB.batch([
    // An echo can arrive before the send response. Keep one authoritative local row.
    env.DB.prepare('DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE organization_id=? AND channel_id=? AND external_message_id=? AND id!=?)').bind(job.organization_id,job.channel_id,result.messageId,job.message_id),
    env.DB.prepare('DELETE FROM messages WHERE organization_id=? AND channel_id=? AND external_message_id=? AND id!=?').bind(job.organization_id,job.channel_id,result.messageId,job.message_id),
    env.DB.prepare(`UPDATE messages SET external_message_id=?,send_status=COALESCE((SELECT status FROM fb_messages WHERE connection_id=? AND message_id=? AND status IN ('DELIVERED','READ')),?) WHERE id=? AND organization_id=?`).bind(result.messageId,job.channel_id,result.messageId,result.status,job.message_id,job.organization_id),
    env.DB.prepare('UPDATE inbox_send_jobs SET status=?,error=?,updated_at=? WHERE id=? AND organization_id=?').bind(result.status,result.error??null,now,job.id,job.organization_id),
    env.DB.prepare("INSERT INTO inbox_audit(organization_id,actor_id,action,target_id,detail,created_at) VALUES(?,?,'SEND_RESULT',?,?,?)").bind(job.organization_id,job.agent_id,job.message_id,JSON.stringify(result),now),
  ]);
}
export async function dispatchFacebook(env:Env,p:Principal,job:SendJob):Promise<void> {
  const membership=await env.DB.prepare('SELECT role FROM memberships WHERE organization_id=? AND user_id=? AND active=1').bind(p.org_id,p.user_id).first<{role:Principal['role']}>();
  if(!membership||membership.role==='viewer')throw new Error('FORBIDDEN');
  p={...p,role:membership.role};
  await conversation(env,p,job.conversation_id);
  const claimed=await env.DB.prepare("UPDATE inbox_send_jobs SET status='SENDING',attempts=attempts+1,updated_at=? WHERE id=? AND organization_id=? AND status='PENDING'").bind(Date.now(),job.id,p.org_id).run();
  if (!claimed.meta.changes) return;
  try {
    const row=await conversation(env,p,job.conversation_id);
    const message=await env.DB.prepare('SELECT content FROM messages WHERE id=? AND organization_id=?').bind(job.message_id,p.org_id).first<{content:string}>();
    const result=await sendMessage(env,p,await ownedPage(env,p,job.channel_id),{requestId:job.id,psid:row.external_id,text:message!.content});
    await finishJob(env,job,result);
  } catch (error) {
    // Preflight failure did not send. An existing platform journal always takes precedence.
    const existing=await env.DB.prepare('SELECT status,message_id FROM fb_outbound WHERE request_id=? AND org_id=?').bind(job.id,p.org_id).first<{status:string;message_id:string|null}>();
    await finishJob(env,job,{status:existing ? existing.status==='SENDING'?'UNKNOWN':existing.status : 'FAILED',messageId:existing?.message_id??null,error:error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)?error.message:'SEND_FAILED'});
  }
}
inbox.post('/conversations/:id/send', async c => {
  const p=c.get('principal'); writer(p); const row=await conversation(c.env,p,c.req.param('id'));
  const input=z.object({requestId:z.uuid(),text,version:z.number().int().nonnegative()}).strict().parse(await body(c.req.raw));
  if (row.platform==='facebook' && input.text.length>2000) throw new Error('TEXT_TOO_LONG');
  const hash=await digest(JSON.stringify({conversation:row.id,text:input.text}));
  const previous=await c.env.DB.prepare('SELECT * FROM inbox_send_jobs WHERE id=?').bind(input.requestId).first<SendJob>();
  if (previous) {
    if (previous.organization_id!==p.org_id || previous.agent_id!==p.user_id || previous.content_hash!==hash) throw new Error('REQUEST_ID_CONFLICT');
    return c.json({id:previous.message_id,status:previous.status});
  }
  if (row.version!==input.version) throw new Error('VERSION_CONFLICT');
  if (await c.env.DB.prepare("SELECT 1 FROM inbox_send_jobs WHERE organization_id=? AND conversation_id=? AND status IN ('PENDING','SENDING','UNKNOWN')").bind(p.org_id,row.id).first()) throw new Error('SEND_IN_PROGRESS');
  const now=Date.now();const messageId=crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO inbox_send_jobs SELECT ?,?,?,?,?,?,?,'PENDING',0,NULL,?,? WHERE EXISTS(SELECT 1 FROM conversations WHERE id=? AND organization_id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM inbox_send_jobs WHERE organization_id=? AND conversation_id=? AND status IN ('PENDING','SENDING','UNKNOWN'))`).bind(input.requestId,p.org_id,row.channel_id,row.id,messageId,p.user_id,hash,now,now,row.id,p.org_id,input.version,p.org_id,row.id),
      c.env.DB.prepare(`INSERT INTO messages(id,organization_id,platform,channel_id,conversation_id,direction,content,sender_id,sender_name,sender_type,agent_id,agent_name,sender_origin,attribution_status,source_created_at,received_at,send_status,created_at)
        SELECT ?,?,?,?,?, 'outgoing',?,u.id,u.name,'agent',u.id,u.name,'desktop_agent','verified',?,?,'PENDING',? FROM users u WHERE u.organization_id=? AND u.id=? AND EXISTS(SELECT 1 FROM inbox_send_jobs WHERE id=? AND message_id=?)`).bind(messageId,p.org_id,row.platform,row.channel_id,row.id,input.text,now,now,now,p.org_id,p.user_id,input.requestId,messageId),
      c.env.DB.prepare('UPDATE conversations SET version=version+1 WHERE id=? AND organization_id=? AND version=? AND EXISTS(SELECT 1 FROM inbox_send_jobs WHERE id=? AND message_id=?)').bind(row.id,p.org_id,input.version,input.requestId,messageId),
      c.env.DB.prepare("INSERT INTO inbox_audit(organization_id,actor_id,action,target_id,detail,created_at) SELECT ?,?,'SEND_QUEUED',?,?,? WHERE EXISTS(SELECT 1 FROM inbox_send_jobs WHERE id=? AND message_id=?)").bind(p.org_id,p.user_id,messageId,input.requestId,now,input.requestId,messageId),
    ]);
  } catch { throw new Error('SEND_IN_PROGRESS'); }
  const job=await c.env.DB.prepare('SELECT * FROM inbox_send_jobs WHERE id=? AND organization_id=?').bind(input.requestId,p.org_id).first<SendJob>();
  if (!job) throw new Error('VERSION_CONFLICT');
  if (row.platform==='facebook') await dispatchFacebook(c.env,p,job);
  const current=await c.env.DB.prepare('SELECT status FROM inbox_send_jobs WHERE id=? AND organization_id=?').bind(job.id,p.org_id).first<{status:string}>();
  return c.json({id:messageId,status:current!.status});
});
inbox.post('/jobs/:id/retry', async c => {
  const p=c.get('principal');writer(p);const job=await c.env.DB.prepare('SELECT * FROM inbox_send_jobs WHERE id=? AND organization_id=?').bind(c.req.param('id'),p.org_id).first<SendJob>();
  if (!job) throw new Error('INBOX_NOT_FOUND'); const row=await conversation(c.env,p,job.conversation_id);
  if (job.agent_id!==p.user_id && !manager(p)) throw new Error('FORBIDDEN');
  if (job.status!=='FAILED') throw new Error('RETRY_UNSAFE');
  const sender=await c.env.DB.prepare("SELECT role FROM memberships WHERE organization_id=? AND user_id=? AND active=1 AND role!='viewer'").bind(p.org_id,job.agent_id).first<{role:Principal['role']}>();
  if(!sender)throw new Error('FORBIDDEN');await channelAccess(c.env,{org_id:p.org_id,user_id:job.agent_id,role:sender.role},job.channel_id);
  // Same platform journal key never retries an ambiguous result. For definitive failures,
  // remove only a FAILED platform journal in the same durable retry transaction.
  const results=await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM fb_outbound WHERE request_id=? AND org_id=? AND status='FAILED' AND EXISTS(SELECT 1 FROM inbox_send_jobs WHERE id=? AND status='FAILED')").bind(job.id,p.org_id,job.id),
    c.env.DB.prepare("UPDATE messages SET send_status='PENDING' WHERE id=? AND organization_id=? AND EXISTS(SELECT 1 FROM inbox_send_jobs WHERE id=? AND status='FAILED')").bind(job.message_id,p.org_id,job.id),
    c.env.DB.prepare("UPDATE inbox_send_jobs SET status='PENDING',updated_at=? WHERE id=? AND organization_id=? AND status='FAILED'").bind(Date.now(),job.id,p.org_id),audit(c.env,p,'SEND_RETRY',job.message_id),
  ]);
  if(!results[2]?.meta.changes)throw new Error('RETRY_UNSAFE');
  // Attribution stays with the original sender; retry actor is separately audited.
  if (row.platform==='facebook') await dispatchFacebook(c.env,{...p,user_id:job.agent_id},job);
  return c.json({queued:true});
});
inbox.get('/conversations/:id/jobs',async c=>{
  const p=c.get('principal');const row=await conversation(c.env,p,c.req.param('id'));
  return c.json({jobs:(await c.env.DB.prepare('SELECT id,message_id,status,error FROM inbox_send_jobs WHERE organization_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 50').bind(p.org_id,row.id).all()).results});
});
inbox.get('/audit',async c=>{
  const p=c.get('principal');if(!manager(p))throw new Error('FORBIDDEN');
  return c.json({events:(await c.env.DB.prepare('SELECT * FROM inbox_audit WHERE organization_id=? ORDER BY id DESC LIMIT 100').bind(p.org_id).all()).results});
});

// Connector transport is deliberately not exposed by the renderer IPC allowlist.
inbox.post('/connector/register',async c=>{
  const p=c.get('principal');if(!['super_admin','admin'].includes(p.role))throw new Error('FORBIDDEN');
  const input=z.object({accountId:z.uuid(),name:z.string().min(1).max(100),connectorUserId:id}).strict().parse(await body(c.req.raw));
  if(!await c.env.DB.prepare("SELECT 1 FROM memberships WHERE organization_id=? AND user_id=? AND active=1 AND role IN ('super_admin','admin','manager')").bind(p.org_id,input.connectorUserId).first())throw new Error('CONNECTOR_MEMBER_REQUIRED');
  await c.env.DB.batch([c.env.DB.prepare("INSERT INTO channel_connections VALUES(?,?,'zalo',?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,connector_user_id=excluded.connector_user_id WHERE channel_connections.organization_id=excluded.organization_id AND channel_connections.platform='zalo'").bind(input.accountId,p.org_id,input.accountId,input.name,input.connectorUserId),audit(c.env,p,'CONNECTOR_REGISTER',input.accountId)]);
  return c.json({saved:true});
});
async function connector(env:Env,p:Principal,channelId:string):Promise<InboxChannel>{
  if(!manager(p))throw new Error('FORBIDDEN');const ch=await channelAccess(env,p,channelId);
  if(ch.platform!=='zalo'||ch.connector_user_id!==p.user_id)throw new Error('FORBIDDEN');return ch;
}
inbox.post('/connector/lease',async c=>{
  const p=c.get('principal');const input=z.object({channelId:z.uuid(),deviceId:z.uuid(),fence:z.uuid().optional()}).strict().parse(await body(c.req.raw));
  await connector(c.env,p,input.channelId);
  if(p.device_id&&p.device_id!==input.deviceId)throw new Error('FORBIDDEN');
  const now=Date.now();const fence=input.fence??crypto.randomUUID();
  const lease=await c.env.DB.prepare(`INSERT INTO connector_leases VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,channel_id) DO UPDATE SET
    device_id=excluded.device_id,user_id=excluded.user_id,fence=excluded.fence,expires_at=excluded.expires_at
    WHERE connector_leases.expires_at<=? OR (connector_leases.device_id=excluded.device_id AND connector_leases.user_id=excluded.user_id AND connector_leases.fence=excluded.fence)
    RETURNING fence,expires_at`).bind(p.org_id,input.channelId,input.deviceId,p.user_id,fence,now+90000,now).first();
  if(!lease)return c.json({error:'CONNECTOR_BUSY'},409);
  return c.json(lease);
});
inbox.post('/connector/bind',async c=>{
  const p=c.get('principal');const input=z.object({channelId:z.uuid(),uid:z.string().regex(/^\d{1,40}$/)}).strict().parse(await body(c.req.raw));
  const ch=await connector(c.env,p,input.channelId);
  await requireLease(c.env,p,input.channelId,c.req.header('X-Device-ID'),c.req.header('X-Connector-Fence'));
  if(ch.external_id!==ch.id&&ch.external_id!==input.uid)throw new Error('ACCOUNT_IDENTITY_CHANGED');
  try{await c.env.DB.prepare("UPDATE channel_connections SET external_id=? WHERE id=? AND organization_id=? AND platform='zalo'").bind(input.uid,input.channelId,p.org_id).run();}catch{throw new Error('DUPLICATE_ACCOUNT');}
  return c.json({saved:true});
});
export async function ingestZalo(env:Env,p:Principal,input:{channelId:string;messageId:string;threadId:string;threadType:0|1;senderId:string;senderName:string;isSelf:boolean;text:string;timestamp:number;attachment:{url:string|null;name:string|null}|null;status:string}):Promise<void>{
  await connector(env,p,input.channelId);const now=Date.now();
  const identity=`zalo:${input.channelId}:${input.threadId}`;const conversationId=identity;
  const messageId=`zalo:${input.channelId}:${input.messageId}`;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO customers(id,organization_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").bind(identity,p.org_id,input.isSelf?input.threadId:input.senderName||input.threadId,input.timestamp,input.timestamp),
    env.DB.prepare("INSERT OR IGNORE INTO customer_identities VALUES(?,?,?,'zalo',?,?)").bind(identity,p.org_id,identity,input.channelId,input.threadId),
    env.DB.prepare('INSERT OR IGNORE INTO conversations(id,organization_id,channel_id,customer_id,external_id,thread_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(conversationId,p.org_id,input.channelId,identity,input.threadId,input.threadType,input.timestamp,input.timestamp),
    env.DB.prepare(`INSERT INTO messages VALUES(?,?,'zalo',?,?,?,?,?,?,?,'customer',NULL,NULL,?,'unknown',?,?,?,?) ON CONFLICT(organization_id,channel_id,external_message_id) DO UPDATE SET send_status=CASE WHEN messages.send_status IN ('SEEN','READ') THEN messages.send_status WHEN excluded.send_status IN ('SEEN','READ','DELIVERED') THEN excluded.send_status ELSE messages.send_status END`).bind(messageId,p.org_id,input.channelId,conversationId,input.messageId,input.isSelf?'outgoing':'incoming',input.text,input.senderId,input.senderName,input.isSelf?'zalo_native':'external',input.timestamp,now,input.status,now),
    env.DB.prepare('UPDATE customers SET updated_at=MAX(updated_at,?) WHERE id=? AND organization_id=?').bind(input.timestamp,identity,p.org_id),
  ]);
  if(input.attachment)await env.DB.prepare('INSERT OR IGNORE INTO attachments SELECT id,id,? FROM messages WHERE organization_id=? AND channel_id=? AND external_message_id=?').bind(JSON.stringify(input.attachment),p.org_id,input.channelId,input.messageId).run();
}
inbox.post('/connector/ingest',async c=>{
  const p=c.get('principal');const input=z.object({channelId:z.uuid(),messageId:id,threadId:z.string().regex(/^\d{1,30}$/),threadType:z.union([z.literal(0),z.literal(1)]),senderId:id,senderName:z.string().max(300),isSelf:z.boolean(),text:z.string().max(20000),timestamp:z.number().int().nonnegative().max(Date.now()+300000),attachment:z.object({url:z.string().max(4096).nullable(),name:z.string().max(500).nullable()}).strict().nullable(),status:z.enum(['RECEIVED','SENT','DELIVERED','SEEN'])}).strict().parse(await body(c.req.raw));
  await connector(c.env,p,input.channelId);
  await requireLease(c.env,p,input.channelId,c.req.header('X-Device-ID'),c.req.header('X-Connector-Fence'));
  await ingestZalo(c.env,p,input);return c.json({saved:true});
});
inbox.post('/connector/claim',async c=>{
  const p=c.get('principal');const input=z.object({channelId:z.uuid()}).strict().parse(await body(c.req.raw));await connector(c.env,p,input.channelId);
  const device=c.req.header('X-Device-ID'),fence=c.req.header('X-Connector-Fence');
  await requireLease(c.env,p,input.channelId,device,fence);
  // Revalidate the original sender before claiming a queued job after role/grant changes.
  const queued=(await c.env.DB.prepare("SELECT j.id,j.message_id,j.agent_id,m.role,m.active FROM inbox_send_jobs j LEFT JOIN memberships m ON m.organization_id=j.organization_id AND m.user_id=j.agent_id WHERE j.organization_id=? AND j.channel_id=? AND j.status='PENDING' ORDER BY j.created_at LIMIT 20").bind(p.org_id,input.channelId).all<{id:string;message_id:string;agent_id:string;role:Principal['role']|null;active:number|null}>()).results;
  for(const item of queued){
    let authorized=Boolean(item.active&&item.role&&item.role!=='viewer');
    if(authorized)try{await channelAccess(c.env,{org_id:p.org_id,user_id:item.agent_id,role:item.role!},input.channelId);}catch{authorized=false;}
    if(!authorized)await c.env.DB.batch([
      c.env.DB.prepare("UPDATE inbox_send_jobs SET status='FAILED',error='SENDER_ACCESS_REVOKED',updated_at=? WHERE id=? AND status='PENDING'").bind(Date.now(),item.id),
      c.env.DB.prepare("UPDATE messages SET send_status='FAILED' WHERE id=? AND organization_id=?").bind(item.message_id,p.org_id),
      audit(c.env,p,'SEND_AUTHORIZATION_REVOKED',item.id),
    ]);
  }
  const job=await c.env.DB.prepare("UPDATE inbox_send_jobs SET status='SENDING',attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM inbox_send_jobs WHERE organization_id=? AND channel_id=? AND status='PENDING' ORDER BY created_at LIMIT 1) AND status='PENDING' AND EXISTS(SELECT 1 FROM connector_leases WHERE organization_id=? AND channel_id=? AND device_id=? AND fence=? AND expires_at>?) RETURNING *").bind(Date.now(),p.org_id,input.channelId,p.org_id,input.channelId,device!,fence!,Date.now()).first<SendJob>();
  if(!job)return c.json({job:null});
  await c.env.DB.prepare('INSERT INTO connector_job_claims VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET device_id=excluded.device_id,fence=excluded.fence').bind(job.id,p.org_id,device!,fence!).run();
  const row=await c.env.DB.prepare('SELECT c.external_id,c.thread_type,m.content FROM conversations c JOIN messages m ON m.id=? WHERE c.id=? AND c.organization_id=?').bind(job.message_id,job.conversation_id,p.org_id).first();
  return c.json({job:{...job,...row}});
});
inbox.post('/connector/result',async c=>{
  const p=c.get('principal');const input=z.object({jobId:z.uuid(),status:z.enum(['SENT','FAILED','UNKNOWN']),messageId:id.nullable(),error:z.string().regex(/^[A-Z0-9_]+$/).max(100).optional()}).strict().refine(v=>v.status!=='SENT'||Boolean(v.messageId)).parse(await body(c.req.raw));
  const job=await c.env.DB.prepare('SELECT * FROM inbox_send_jobs WHERE id=? AND organization_id=?').bind(input.jobId,p.org_id).first<SendJob>();if(!job)throw new Error('INBOX_NOT_FOUND');await connector(c.env,p,job.channel_id);
  // Results may arrive after TTL/crash, but only the original fenced device can reconcile its own claim.
  if(!await c.env.DB.prepare('SELECT 1 FROM connector_job_claims WHERE job_id=? AND organization_id=? AND device_id=? AND fence=?').bind(job.id,p.org_id,c.req.header('X-Device-ID')??'',c.req.header('X-Connector-Fence')??'').first())throw new Error('CONNECTOR_LEASE_LOST');
  if(job.status===input.status)return c.json({saved:true});
  if(!['SENDING','UNKNOWN'].includes(job.status))throw new Error('JOB_NOT_CLAIMED');await finishJob(c.env,job,input);return c.json({saved:true});
});
export async function recoverInbox(env:Env):Promise<void>{
  await env.DB.batch([
    env.DB.prepare("UPDATE messages SET send_status='UNKNOWN' WHERE id IN (SELECT message_id FROM inbox_send_jobs WHERE status='SENDING' AND updated_at<?)").bind(Date.now()-120000),
    env.DB.prepare("UPDATE inbox_send_jobs SET status='UNKNOWN',error='INTERRUPTED_SEND' WHERE status='SENDING' AND updated_at<?").bind(Date.now()-120000),
  ]);
  const pending=(await env.DB.prepare("SELECT j.* FROM inbox_send_jobs j JOIN channel_connections c ON c.id=j.channel_id AND c.organization_id=j.organization_id WHERE j.status='PENDING' AND c.platform='facebook' ORDER BY j.created_at LIMIT 10").all<SendJob>()).results;
  for(const job of pending){
    const member=await env.DB.prepare('SELECT role FROM memberships WHERE organization_id=? AND user_id=? AND active=1').bind(job.organization_id,job.agent_id).first<{role:Principal['role']}>();
    try{
      if(!member||member.role==='viewer')throw new Error('FORBIDDEN');
      await dispatchFacebook(env,{org_id:job.organization_id,user_id:job.agent_id,role:member.role},job);
    }catch{
      const current=await env.DB.prepare('SELECT status FROM inbox_send_jobs WHERE id=?').bind(job.id).first<{status:string}>();
      if(current?.status==='PENDING')await finishJob(env,job,{status:'FAILED',messageId:null,error:'SENDER_ACCESS_REVOKED'});
    }
  }
}