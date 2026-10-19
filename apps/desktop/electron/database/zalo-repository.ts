import type Database from 'better-sqlite3';
import type { ZaloMessage, ZaloSendInput } from '@pvh/shared/types';
import { randomUUID } from 'node:crypto';
const statementCaches = new WeakMap<Database.Database, Map<string, Database.Statement>>();
function prepare(db: Database.Database, sql: string): Database.Statement {
  let cache = statementCaches.get(db);
  if (!cache) { cache = new Map(); statementCaches.set(db, cache); }
  let statement = cache.get(sql);
  if (!statement) { statement = db.prepare(sql); cache.set(sql, statement); }
  return statement;
}
export function saveZaloMessage(db: Database.Database, message: ZaloMessage): void {
  db.transaction(() => {
    prepare(db, `INSERT INTO zalo_threads(account_id,thread_id,thread_type,title,updated_at,preview) VALUES (?,?,?,?,?,?)
      ON CONFLICT(account_id,thread_id) DO UPDATE SET updated_at=MAX(updated_at,excluded.updated_at),preview=CASE WHEN excluded.updated_at>=updated_at THEN excluded.preview ELSE preview END`).run(message.accountId, message.threadId, message.threadType, message.isSelf ? message.threadId : message.senderName || message.threadId, message.timestamp, message.text.slice(0, 300));
    const existing = prepare(db, 'SELECT payload FROM zalo_messages WHERE platform=? AND account_id=? AND message_id=?').get('zalo', message.accountId, message.messageId) as { payload: string } | undefined;
    const previous = existing ? JSON.parse(existing.payload) as ZaloMessage : null;
    const next = { ...message, agentId: previous?.agentId ?? message.agentId,
      status: previous?.status === 'SEEN' || previous?.status === 'DELIVERED' ? previous.status : message.status };
    prepare(db, `INSERT INTO zalo_messages(platform,account_id,message_id,thread_id,timestamp,payload) VALUES ('zalo',?,?,?,?,?)
      ON CONFLICT(platform,account_id,message_id) DO UPDATE SET payload=excluded.payload`).run(message.accountId, message.messageId, message.threadId, message.timestamp, JSON.stringify(next));
    if (!message.isSelf) prepare(db, "INSERT INTO zalo_gateway_outbox(account_id,message_id,payload) VALUES (?,?,?) ON CONFLICT(account_id,message_id) DO NOTHING").run(message.accountId, message.messageId, JSON.stringify(next));
    prepare(db, "INSERT INTO inbox_connector_outbox(account_id,message_id,payload) VALUES (?,?,?) ON CONFLICT(account_id,message_id) DO UPDATE SET payload=excluded.payload,status='PENDING' WHERE payload!=excluded.payload").run(message.accountId,message.messageId,JSON.stringify(next));
  })();
}
export function zaloDatabaseOperation(db: Database.Database, method: string, input: unknown): unknown {
  const p = input as Record<string, unknown>;
  switch (method) {
    case 'zalo:messages-batch': {
      const messages = input as ZaloMessage[];
      if (!Array.isArray(messages) || messages.length > 100) throw new Error('INVALID_MESSAGE_BATCH');
      db.transaction(() => { for (const message of messages) saveZaloMessage(db, message); })();
      return true;
    }
    case 'inbox:outbox': return prepare(db, "SELECT id,payload FROM inbox_connector_outbox WHERE account_id=? AND status='PENDING' ORDER BY id LIMIT 50").all(p.accountId);
    case 'inbox:ack': prepare(db, "UPDATE inbox_connector_outbox SET status='SYNCED' WHERE id=? AND payload=?").run(p.id,p.payload); return true;
    case 'inbox:attempt': {
      prepare(db, 'INSERT OR IGNORE INTO inbox_connector_attempts VALUES(?,?,?)').run(p.jobId,p.attempt,randomUUID());
      return (prepare(db, 'SELECT request_id FROM inbox_connector_attempts WHERE job_id=? AND attempt=?').get(p.jobId,p.attempt) as {request_id:string}).request_id;
    }
    case 'inbox:send-result': return prepare(db, 'SELECT status,external_id AS messageId FROM zalo_outbound WHERE id=?').get(p.requestId) ?? null;
    case 'inbox:result-save': prepare(db, 'INSERT INTO inbox_connector_results VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET payload=excluded.payload').run(p.jobId,JSON.stringify(input)); return true;
    case 'inbox:results': return prepare(db, 'SELECT * FROM inbox_connector_results LIMIT 50').all();
    case 'inbox:result-ack': prepare(db, 'DELETE FROM inbox_connector_results WHERE job_id=?').run(p.jobId); return true;
    case 'zalo:list': return prepare(db, 'SELECT id,label,uid,display_name AS displayName,avatar,owner_id AS ownerId,state,encrypted_session IS NOT NULL AS hasSession FROM zalo_accounts ORDER BY created_at,id').all();
    case 'zalo:add': prepare(db, 'INSERT INTO zalo_accounts(id,label,owner_id) VALUES (?,?,?)').run(p.id, p.label, p.ownerId); return true;
    case 'zalo:state': prepare(db, 'UPDATE zalo_accounts SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(p.state, p.id); return true;
    case 'zalo:profile': prepare(db, 'UPDATE zalo_accounts SET display_name=?,avatar=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(p.displayName, p.avatar, p.id); return true;
    case 'zalo:identity': prepare(db, 'UPDATE zalo_accounts SET uid=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(p.uid, p.id); return true;
    case 'zalo:save-session': prepare(db, 'UPDATE zalo_accounts SET encrypted_session=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(p.session ? Buffer.from(p.session as Uint8Array) : null, p.id); return true;
    case 'zalo:session': return (prepare(db, 'SELECT encrypted_session AS session FROM zalo_accounts WHERE id=?').get(p.id) as { session: Buffer | null } | undefined)?.session ?? null;
    case 'zalo:log': db.transaction(() => { prepare(db, 'INSERT INTO zalo_logs(account_id,code) VALUES (?,?)').run(p.id, p.code); prepare(db, 'DELETE FROM zalo_logs WHERE id IN (SELECT id FROM zalo_logs WHERE account_id=? ORDER BY id DESC LIMIT -1 OFFSET 200)').run(p.id); })(); return true;
    case 'zalo:logs': return prepare(db, 'SELECT id,account_id AS accountId,code,created_at AS createdAt FROM zalo_logs ORDER BY id DESC LIMIT 200').all();
    case 'zalo:threads': return prepare(db, 'SELECT account_id AS accountId,thread_id AS threadId,thread_type AS threadType,title,updated_at AS updatedAt,preview FROM zalo_threads WHERE account_id=? ORDER BY updated_at DESC LIMIT 200').all(p.accountId);
    case 'zalo:messages': return (prepare(db, 'SELECT payload FROM (SELECT payload,timestamp FROM zalo_messages WHERE account_id=? AND thread_id=? ORDER BY timestamp DESC LIMIT 200) ORDER BY timestamp').all(p.accountId, p.threadId) as { payload: string }[]).map(row => JSON.parse(row.payload) as ZaloMessage);
    case 'zalo:message': saveZaloMessage(db, input as ZaloMessage); return true;
    case 'zalo:delivery': {
      for (const id of (p.messageIds as string[]).slice(0, 1000)) {
        const row = prepare(db, 'SELECT payload FROM zalo_messages WHERE account_id=? AND message_id=?').get(p.accountId, id) as { payload: string } | undefined;
        if (row) { const message = JSON.parse(row.payload) as ZaloMessage; if (message.isSelf && message.status !== 'SEEN') saveZaloMessage(db, { ...message, status: p.status as 'SEEN' | 'DELIVERED' }); }
      }
      return true;
    }
    case 'zalo:outbound-begin': {
      const send = input as ZaloSendInput;
      const inserted = prepare(db, "INSERT INTO zalo_outbound(id,account_id,thread_id,thread_type,text,status) VALUES (?,?,?,?,?,'SENDING') ON CONFLICT(id) DO NOTHING").run(send.requestId, send.accountId, send.threadId, send.threadType, send.text).changes === 1;
      return { ...prepare(db, 'SELECT account_id AS accountId,thread_id AS threadId,text,status,external_id AS messageId FROM zalo_outbound WHERE id=?').get(send.requestId) as object, inserted };
    }
    case 'zalo:outbound-result': prepare(db, 'UPDATE zalo_outbound SET status=?,external_id=?,error=? WHERE id=? AND account_id=?').run(p.status, p.messageId ?? null, p.error ?? null, p.requestId, p.accountId); return true;
    case 'zalo:recover-outbound': prepare(db, "UPDATE zalo_outbound SET status='UNKNOWN',error='APP_RESTART_SEND_UNCONFIRMED' WHERE status='SENDING'").run(); return true;
    case 'zalo:failures': return prepare(db, "SELECT id,account_id AS accountId,thread_id AS threadId,text,status,attempts,error FROM zalo_outbound WHERE status IN ('FAILED','UNKNOWN') ORDER BY created_at DESC LIMIT 100").all();
    default: throw new Error('UNKNOWN_ZALO_DATABASE_OPERATION');
  }
}