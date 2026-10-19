import { z } from 'zod';
import { digest } from './security';
import type { Env, NormalizedEvent } from './types';
const id = z.string().regex(/^\d{1,40}$/);
const eventSchema = z.object({
  sender: z.object({ id }), recipient: z.object({ id }), timestamp: z.number().int().nonnegative(),
  message: z.object({ mid: z.string().min(1).max(512), text: z.string().max(20000).optional(), is_echo: z.boolean().optional(), attachments: z.array(z.unknown()).max(100).optional(), is_deleted: z.boolean().optional(), is_unsupported: z.boolean().optional() }).optional(),
  delivery: z.object({ mids: z.array(z.string().max(512)).max(1000).optional(), watermark: z.number().int().nonnegative().optional() }).optional(),
  read: z.object({ watermark: z.number().int().nonnegative() }).optional(),
});
export const webhookSchema = z.object({ object: z.literal('page'), entry: z.array(z.object({ id, time: z.number().optional(), messaging: z.array(z.unknown()).max(500).optional(), standby: z.array(z.unknown()).optional(), changes: z.array(z.unknown()).optional() })).max(100) });
export function normalize(pageId: string, raw: unknown): NormalizedEvent | null {
  const parsed = eventSchema.safeParse(raw); if (!parsed.success) return null;
  const event = parsed.data;
  const echo = event.message?.is_echo === true;
  if ((echo ? event.sender.id : event.recipient.id) !== pageId) return null;
  const psid = echo ? event.recipient.id : event.sender.id;
  if (psid === pageId) return null;
  const kind = event.message ? 'message' : event.delivery ? 'delivery' : event.read ? 'read' : null;
  if (!kind) return null;
  return { pageId, psid, conversationId: `facebook:${pageId}:${psid}`, timestamp: event.timestamp, kind,
    messageId: event.message?.mid ?? null, echo, text: event.message?.text ?? '', attachments: event.message?.attachments ?? [],
    mids: event.delivery?.mids ?? [], watermark: event.delivery?.watermark ?? event.read?.watermark ?? null };
}
export async function persistWebhook(env: Env, payload: unknown): Promise<number> {
  const body = webhookSchema.parse(payload); const statements: D1PreparedStatement[] = [];
  for (const entry of body.entry) {
    const page = await env.DB.prepare("SELECT id,org_id FROM fb_pages WHERE page_id=? AND token IS NOT NULL AND status != 'DISCONNECTED'").bind(entry.id).first<{ id: string; org_id: string }>();
    if (!page) continue;
    for (const raw of entry.messaging ?? []) {
      const event = normalize(entry.id, raw); if (!event) continue;
      const key = await digest(event.messageId ? `facebook:${entry.id}:${event.messageId}` : JSON.stringify(event));
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO fb_events(event_key,org_id,connection_id,payload,received_at) VALUES(?,?,?,?,?)').bind(key, page.org_id, page.id, JSON.stringify(event), Date.now()));
    }
  }
  // D1 batches are atomic. Never acknowledge an uncommitted accepted event.
  let stored = 0;
  for (let i = 0; i < statements.length; i += 80) {
    const results = await env.DB.batch(statements.slice(i, i + 80));
    stored += results.reduce((sum, result) => sum + result.meta.changes, 0);
  }
  return stored;
}
export async function processEvents(env: Env): Promise<void> {
  const rows = await env.DB.prepare("SELECT event_key,connection_id,payload,attempts FROM fb_events WHERE status='PENDING' AND next_attempt<=? ORDER BY received_at LIMIT 50").bind(Date.now()).all<{ event_key: string; connection_id: string; payload: string; attempts: number }>();
  for (const row of rows.results) {
    try {
      const event = JSON.parse(row.payload) as NormalizedEvent;
      const page = await env.DB.prepare("SELECT id FROM fb_pages WHERE id=? AND token IS NOT NULL AND status!='DISCONNECTED'").bind(row.connection_id).first();
      const statements: D1PreparedStatement[] = [];
      if (page && event.kind === 'message' && event.messageId) {
        const inbound = !event.echo && event.timestamp <= Date.now() + 60000 ? Math.min(event.timestamp, Date.now()) : 0;
        statements.push(env.DB.prepare('INSERT INTO fb_threads(connection_id,psid,conversation_id,last_inbound) VALUES(?,?,?,?) ON CONFLICT(connection_id,psid) DO UPDATE SET last_inbound=MAX(last_inbound,excluded.last_inbound)').bind(row.connection_id, event.psid, event.conversationId, inbound));
        statements.push(env.DB.prepare("INSERT INTO fb_messages(connection_id,message_id,psid,direction,text,attachments,timestamp,agent_id,status) VALUES(?,?,?,?,?,?,?,NULL,?) ON CONFLICT(connection_id,message_id) DO NOTHING").bind(row.connection_id, event.messageId, event.psid, event.echo ? 'outgoing' : 'incoming', event.text, JSON.stringify(event.attachments), event.timestamp, event.echo ? 'ACCEPTED' : 'RECEIVED'));
      } else if (page && event.kind === 'delivery') {
        for (const mid of event.mids) statements.push(env.DB.prepare('INSERT OR IGNORE INTO fb_receipts(connection_id,psid,message_id) VALUES(?,?,?)').bind(row.connection_id, event.psid, mid));
      } else if (page && event.kind === 'read' && event.watermark) {
        statements.push(env.DB.prepare('INSERT INTO fb_read_watermarks(connection_id,psid,watermark) VALUES(?,?,?) ON CONFLICT(connection_id,psid) DO UPDATE SET watermark=MAX(watermark,excluded.watermark)').bind(row.connection_id, event.psid, event.watermark));
      }
      // A receipt can race the echo/send response. Reconcile persisted receipts on every
      // pass so a later message insert never regresses READ/DELIVERED to ACCEPTED.
      if (page) {
        statements.push(env.DB.prepare("UPDATE fb_messages SET status='DELIVERED' WHERE connection_id=? AND psid=? AND direction='outgoing' AND status!='READ' AND EXISTS(SELECT 1 FROM fb_receipts r WHERE r.connection_id=fb_messages.connection_id AND r.psid=fb_messages.psid AND r.message_id=fb_messages.message_id)").bind(row.connection_id, event.psid));
        statements.push(env.DB.prepare("UPDATE fb_messages SET status='READ' WHERE connection_id=? AND psid=? AND direction='outgoing' AND timestamp<=(SELECT watermark FROM fb_read_watermarks WHERE connection_id=? AND psid=?)").bind(row.connection_id, event.psid, row.connection_id, event.psid));
      }
      statements.push(env.DB.prepare("UPDATE fb_events SET status='PROCESSED',error=NULL WHERE event_key=?").bind(row.event_key));
      for (let index = 0; index < statements.length; index += 80) await env.DB.batch(statements.slice(index, index + 80));
    } catch {
      await env.DB.prepare("UPDATE fb_events SET attempts=attempts+1,status=?,error='PROCESSING_FAILED',next_attempt=? WHERE event_key=? AND status='PENDING'").bind(row.attempts >= 4 ? 'DEAD' : 'PENDING', Date.now() + Math.min(3600000, 5000 * 3 ** row.attempts), row.event_key).run();
    }
  }
}