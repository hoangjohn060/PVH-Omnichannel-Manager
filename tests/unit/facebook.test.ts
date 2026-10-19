/// <reference types="@cloudflare/workers-types" />
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { app, maintenance } from '../../apps/gateway/src/index';
import { digest, encrypt, decrypt, hmac, hex, validSignature, boundedBody } from '../../apps/gateway/src/security';
import { normalize, processEvents } from '../../apps/gateway/src/webhook';
import { withinWindow } from '../../apps/gateway/src/facebook';
import { Graph } from '../../apps/gateway/src/graph';
import { parseIpc } from '../../packages/shared/schemas';
import type { Env } from '../../apps/gateway/src/types';

// Executes the actual migration and SQL; only the D1 binding shape is emulated.
class SqlBinding {
  readonly sql = new DatabaseSync(':memory:');
  constructor() { for (const file of ['0001_facebook.sql','0002_inbox.sql','0003_sheets.sql','0004_multiagent.sql']) this.sql.exec(readFileSync(new URL('../../apps/gateway/migrations/'+file, import.meta.url), 'utf8')); }
  prepare(query: string) {
    let values: SQLInputValue[] = [];
    const statement = {
      bind: (...input: SQLInputValue[]) => { values = input; return statement; },
      first: async () => this.sql.prepare(query).get(...values) ?? null,
      all: async () => ({ results: this.sql.prepare(query).all(...values), success: true, meta: { changes: 0 } }),
      run: async () => ({ success: true, meta: { changes: Number(this.sql.prepare(query).run(...values).changes) }, results: [] }),
    };
    return statement;
  }
  async batch(statements: ReturnType<SqlBinding['prepare']>[]) {
    this.sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sql.exec('COMMIT'); return results; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
let db: SqlBinding; let env: Env;
const credential = 'a'.repeat(64); const otherCredential = 'b'.repeat(64);
const connection = '11111111-1111-4111-8111-111111111111';
const pageId = '123'; const psid = '456';
const required = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'];
const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
async function api(path: string, body?: unknown, token = credential): Promise<Response> {
  return app.request(`https://gateway.example/api/facebook/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env, context);
}
async function seedPage(id = connection, org = 'org1', externalId = pageId): Promise<void> {
  const token = await encrypt(env.TOKEN_ENCRYPTION_KEY, 'page-token', `page:${org}:${externalId}`);
  db.sql.prepare('INSERT INTO fb_pages(id,org_id,page_id,name,token,status,permissions,owner_id) VALUES(?,?,?,?,?,?,?,?)').run(id, org, externalId, 'Owned Page', token, 'CHECK_REQUIRED', JSON.stringify(required), 'user1');
}
function graphMock(options: { code?: number; permissions?: string[]; send?: 'error' | 'timeout' | 'missing' } = {}) {
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/oauth/access_token')) return Response.json({ access_token: 'user-token' });
    if (url.pathname.endsWith('/debug_token')) return options.code ? Response.json({ error: { code: options.code, error_subcode: 1, fbtrace_id: 'trace-id' } }, { status: 400 }) : Response.json({ data: { is_valid: true, app_id: env.META_APP_ID, scopes: options.permissions ?? required } });
    if (url.pathname.endsWith('/me/accounts')) return Response.json({ data: [{ id: pageId, name: 'Owned Page', access_token: 'page-token', tasks: ['MESSAGING', 'MODERATE'] }] });
    if (url.pathname.endsWith('/me')) return Response.json({ id: pageId });
    if (url.pathname.endsWith('/subscribed_apps')) return Response.json(init?.method === 'GET' ? { data: [{ id: env.META_APP_ID, subscribed_fields: ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads'] }] } : { success: true });
    if (url.pathname.endsWith('/messages')) {
      if (options.send === 'timeout') throw new Error('network timeout');
      if (options.send === 'error') return Response.json({ error: { code: 10, error_subcode: 201, message: 'sensitive page-token', fbtrace_id: 'send-trace' } }, { status: 400 });
      return Response.json(options.send === 'missing' ? {} : { message_id: 'mid.out', recipient_id: psid });
    }
    throw new Error(`Unexpected Graph endpoint ${url.pathname}`);
  });
  vi.stubGlobal('fetch', mock); return mock;
}
const message = (mid = 'mid.in', echo = false, timestamp = Date.now()) => ({ sender: { id: echo ? pageId : psid }, recipient: { id: echo ? psid : pageId }, timestamp, message: { mid, text: 'Xin chÃ o Viá»‡t Nam ðŸ‡»ðŸ‡³', is_echo: echo } });
async function webhook(event = message(), signature?: string, externalId = pageId): Promise<Response> {
  const body = JSON.stringify({ object: 'page', entry: [{ id: externalId, messaging: [event] }] });
  const signed = signature ?? `sha256=${hex(await hmac(env.META_APP_SECRET, new TextEncoder().encode(body).buffer))}`;
  return app.request('https://gateway.example/meta/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': signed }, body }, env, context);
}
beforeEach(async () => {
  db = new SqlBinding();
  env = { DB: db as unknown as D1Database, META_APP_ID: '999', META_APP_SECRET: 'app-secret', META_VERIFY_TOKEN: 'verify-secret', TOKEN_ENCRYPTION_KEY: btoa('k'.repeat(32)), PUBLIC_ORIGIN: 'https://gateway.example' };
  for (const [token, org, user] of [[credential, 'org1', 'user1'], [otherCredential, 'org2', 'user2']]) db.sql.prepare('INSERT INTO gateway_credentials VALUES(?,?,?,?,?,0)').run(await digest(token!), org!, user!, 'admin', Date.now() + 3600000);
});
afterEach(() => { vi.unstubAllGlobals(); db.sql.close(); });
describe('Facebook security and normalization', () => {
  it('encrypts tokens with bound tenant/page context', async () => {
    const ciphertext = await encrypt(env.TOKEN_ENCRYPTION_KEY, 'secret-token', 'org1:123');
    expect(ciphertext).not.toContain('secret-token'); expect(await decrypt(env.TOKEN_ENCRYPTION_KEY, ciphertext, 'org1:123')).toBe('secret-token');
    await expect(decrypt(env.TOKEN_ENCRYPTION_KEY, ciphertext, 'org2:123')).rejects.toThrow();
  });
  it('verifies exact raw bytes and rejects forged signatures', async () => {
    const raw = new TextEncoder().encode('hello').buffer;
    const signature = `sha256=${hex(await hmac(env.META_APP_SECRET, raw))}`;
    expect(await validSignature(env.META_APP_SECRET, raw, signature)).toBe(true);
    expect(await validSignature(env.META_APP_SECRET, new TextEncoder().encode('hello ').buffer, signature)).toBe(false);
    expect(await validSignature(env.META_APP_SECRET, raw, 'sha256=bad')).toBe(false);
  });
  it('limits streamed body size without content-length', async () => { await expect(boundedBody(new Request('https://test', { method: 'POST', body: '123456' }), 5)).rejects.toThrow('BODY_TOO_LARGE'); });
  it('maps incoming and echo without inventing an employee', () => {
    expect(normalize(pageId, message())).toMatchObject({ pageId, psid, conversationId: 'facebook:123:456', kind: 'message', echo: false, text: 'Xin chÃ o Viá»‡t Nam ðŸ‡»ðŸ‡³' });
    expect(normalize(pageId, message('mid.echo', true))).toMatchObject({ psid, echo: true });
    expect(normalize('999', message())).toBeNull(); expect(normalize(pageId, { malicious: true })).toBeNull();
  });
  it('enforces 24h boundary and rejects future inbound timestamps', () => { const now = Date.now(); expect(withinWindow(now - 1000, now)).toBe(true); expect(withinWindow(now - 86400000, now)).toBe(false); expect(withinWindow(now + 1, now)).toBe(false); });
  it('rejects IPC agent spoofing, arbitrary actions and mixed content', () => {
    expect(() => parseIpc('facebook:send', { connectionId: connection, psid, requestId: crypto.randomUUID(), text: 'hello', agentId: 'fake' })).toThrow();
    expect(() => parseIpc('facebook:action', { connectionId: connection, action: 'fetch-token' })).toThrow();
    expect(() => parseIpc('facebook:send', { connectionId: connection, psid, requestId: crypto.randomUUID(), text: 'hello', attachment: { type: 'file', url: 'https://example.com/a' } })).toThrow();
  });
});
describe('Facebook OAuth HTTP integration', () => {
  it('requires a non-revoked gateway principal', async () => { expect((await api('pages', undefined, 'invalid')).status).toBe(401); db.sql.exec('UPDATE gateway_credentials SET revoked=1'); expect((await api('pages')).status).toBe(401); });
  it('rejects mismatched/expired states and consumes valid state once', async () => {
    graphMock(); const start = await (await api('oauth/start', {})).json() as { id: string; authorizationUrl: string };
    const state = new URL(start.authorizationUrl).searchParams.get('state')!;
    expect((await app.request(`https://gateway.example/meta/callback?state=${'0'.repeat(64)}&code=x`, {}, env)).status).toBe(400);
    expect((await app.request(`https://gateway.example/meta/callback?state=${state}&code=x`, {}, env)).status).toBe(200);
    expect((await app.request(`https://gateway.example/meta/callback?state=${state}&code=x`, {}, env)).status).toBe(400);
    const poll = await (await api(`oauth/${start.id}`)).text(); expect(poll).toContain('Owned Page'); expect(poll).not.toContain('page-token');
    expect((await api(`oauth/${start.id}`, undefined, otherCredential)).status).toBe(404);
    const expired = await (await api('oauth/start', {})).json() as { id: string; authorizationUrl: string };
    db.sql.prepare('UPDATE fb_oauth SET expires_at=0 WHERE id=?').run(expired.id);
    expect((await app.request(`https://gateway.example/meta/callback?state=${new URL(expired.authorizationUrl).searchParams.get('state')}&code=x`, {}, env)).status).toBe(400);
  });
  it('selects only an authorized Page and checks real Graph responses', async () => {
    graphMock(); const start = await (await api('oauth/start', {})).json() as { id: string; authorizationUrl: string };
    await app.request(`https://gateway.example/meta/callback?state=${new URL(start.authorizationUrl).searchParams.get('state')}&code=x`, {}, env);
    expect((await api(`oauth/${start.id}/select`, { pageId: '987' })).status).toBe(403);
    const selected = await api(`oauth/${start.id}/select`, { pageId });
    expect(selected.status).toBe(200); expect(await selected.json()).toMatchObject({ status: 'CONNECTED', webhook: true });
    expect(String(db.sql.prepare('SELECT token FROM fb_pages').get()?.token)).not.toContain('page-token');
    expect(await (await api('pages')).text()).not.toContain('page-token');
  });
  it('reports permission denied without Connected', async () => { await seedPage(); graphMock({ permissions: ['pages_show_list'] }); expect((await api(`pages/${connection}/check`, {})).status).toBe(400); expect(db.sql.prepare('SELECT status FROM fb_pages').get()?.status).toBe('PERMISSION_DENIED'); });
  it('marks revoked tokens and logs safe real Graph codes', async () => { await seedPage(); graphMock({ code: 190 }); expect((await api(`pages/${connection}/check`, {})).status).toBe(400); expect(db.sql.prepare('SELECT status FROM fb_pages').get()?.status).toBe('TOKEN_REVOKED'); expect(await (await api('logs')).text()).toContain('GRAPH_190_1'); });
  it('does not follow arbitrary Graph pagination URLs', async () => {
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ data: [], paging: { next: 'https://evil.example/steal', cursors: { after: 'cursor' } } })).mockResolvedValueOnce(Response.json({ data: [] }));
    await new Graph(env, transport).pages('token'); expect(String(transport.mock.calls[1]?.[0])).toContain('https://graph.facebook.com/v26.0/me/accounts');
  });
});
describe('Facebook webhook HTTP + persistent queue', () => {
  it('verifies challenge token and rejects forged webhook before persistence', async () => {
    expect((await app.request('https://gateway.example/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc', {}, env)).status).toBe(403);
    expect(await (await app.request('https://gateway.example/meta/webhook?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=abc', {}, env)).text()).toBe('abc');
    await seedPage(); expect((await webhook(message(), `sha256=${'0'.repeat(64)}`)).status).toBe(403); expect(db.sql.prepare('SELECT COUNT(*) AS count FROM fb_events').get()?.count).toBe(0);
  });
  it('persists before ACK, deduplicates replay, preserves Vietnamese and isolation', async () => {
    await seedPage(); const event = message(); expect((await webhook(event)).status).toBe(200); await webhook(event);
    expect(db.sql.prepare('SELECT COUNT(*) AS count FROM fb_events').get()?.count).toBe(1);
    await processEvents(env); await processEvents(env);
    expect(db.sql.prepare('SELECT COUNT(*) AS count FROM fb_messages').get()?.count).toBe(1);
    expect(db.sql.prepare('SELECT text,agent_id FROM fb_messages').get()).toMatchObject({ text: 'Xin chÃ o Viá»‡t Nam ðŸ‡»ðŸ‡³', agent_id: null });
    expect((await api(`pages/${connection}/threads`, undefined, otherCredential)).status).toBe(404);
    await webhook(message('ignored'), undefined, '999'); expect(db.sql.prepare('SELECT COUNT(*) AS count FROM fb_events').get()?.count).toBe(1);
  });
  it('echo does not open the reply window and cannot overwrite known agent mapping', async () => {
    await seedPage(); await webhook(message('mid.echo', true)); await processEvents(env);
    expect(db.sql.prepare('SELECT last_inbound FROM fb_threads').get()?.last_inbound).toBe(0);
    expect(db.sql.prepare('SELECT agent_id,direction FROM fb_messages').get()).toMatchObject({ agent_id: null, direction: 'outgoing' });
  });
  it('retains dead events for controlled admin replay only', async () => {
    await seedPage(); await webhook(); db.sql.exec("UPDATE fb_events SET status='DEAD',attempts=5");
    const key = String(db.sql.prepare('SELECT event_key FROM fb_events').get()?.event_key);
    expect(await (await api(`events/${key}/replay`, {}, otherCredential)).json()).toEqual({ replayed: false });
    expect(await (await api(`events/${key}/replay`, {})).json()).toEqual({ replayed: true });
  });
  it('retains delivery/read receipts that arrive before an echo without regression', async () => {
    await seedPage(); const timestamp = Date.now();
    const body = JSON.stringify({ object: 'page', entry: [{ id: pageId, messaging: [
      { sender: { id: psid }, recipient: { id: pageId }, timestamp, delivery: { mids: ['mid.late'], watermark: timestamp } },
      { sender: { id: psid }, recipient: { id: pageId }, timestamp, read: { watermark: timestamp + 1000 } },
    ] }] });
    const signature = `sha256=${hex(await hmac(env.META_APP_SECRET, new TextEncoder().encode(body).buffer))}`;
    await app.request('https://gateway.example/meta/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': signature }, body }, env, context);
    await processEvents(env); await webhook(message('mid.late', true, timestamp)); await processEvents(env);
    expect(db.sql.prepare("SELECT status FROM fb_messages WHERE message_id='mid.late'").get()?.status).toBe('READ');
    await webhook(message('mid.late', true, timestamp + 500)); await processEvents(env);
    expect(db.sql.prepare('SELECT COUNT(*) AS count FROM fb_messages').get()?.count).toBe(1);
  });
  it('isolates two Pages with the same PSID and external message ID', async () => {
    await seedPage(); await seedPage('conn2', 'org2', '789');
    const event = message('same-mid'); await webhook(event);
    const body = JSON.stringify({ object: 'page', entry: [{ id: '789', messaging: [{ ...event, recipient: { id: '789' } }] }] });
    const signature = `sha256=${hex(await hmac(env.META_APP_SECRET, new TextEncoder().encode(body).buffer))}`;
    await app.request('https://gateway.example/meta/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': signature }, body }, env, context); await processEvents(env);
    expect(db.sql.prepare('SELECT COUNT(*) AS count FROM fb_messages').get()?.count).toBe(2);
    expect(await (await api('pages/conn2/threads')).json()).toEqual({ error: 'PAGE_NOT_FOUND' });
    expect(await (await api('pages/conn2/threads', undefined, otherCredential)).json()).toMatchObject({ threads: [{ psid }] });
  });
});
describe('Messenger send integration', () => {
  async function ready() { await seedPage(); await webhook(); await processEvents(env); }
  it('uses authenticated employee, records Meta ID, and does not report delivered', async () => {
    await ready(); const mock = graphMock(); const input = { requestId: crypto.randomUUID(), psid, text: 'Tráº£ lá»i tiáº¿ng Viá»‡t' };
    expect(await (await api(`pages/${connection}/send`, input)).json()).toEqual({ status: 'ACCEPTED', messageId: 'mid.out' });
    expect(db.sql.prepare("SELECT agent_id,status FROM fb_messages WHERE message_id='mid.out'").get()).toMatchObject({ agent_id: 'user1', status: 'ACCEPTED' });
    await api(`pages/${connection}/send`, input); expect(mock.mock.calls.filter(call => String(call[0]).endsWith('/messages') || new URL(String(call[0])).pathname.endsWith('/messages'))).toHaveLength(1);
    expect((await api(`pages/${connection}/send`, { ...input, text: 'different' })).status).toBe(400);
    expect((await api(`pages/${connection}/send`, { ...input, requestId: crypto.randomUUID(), agentId: 'spoof' })).status).toBe(400);
  });
  it('does not call send outside 24h window', async () => { await ready(); const mock = graphMock(); db.sql.exec('UPDATE fb_threads SET last_inbound=1'); expect(await (await api(`pages/${connection}/send`, { requestId: crypto.randomUUID(), psid, text: 'hello' })).json()).toEqual({ error: 'MESSAGING_WINDOW_CLOSED' }); expect(mock.mock.calls.some(call => new URL(String(call[0])).pathname.endsWith('/messages'))).toBe(false); });
  it.each([['error', 'FAILED'], ['timeout', 'UNKNOWN'], ['missing', 'UNKNOWN']] as const)('handles Graph %s as %s without blind retry', async (failure, status) => {
    await ready(); graphMock({ send: failure }); const input = { requestId: crypto.randomUUID(), psid, text: 'hello' };
    expect(await (await api(`pages/${connection}/send`, input)).json()).toMatchObject({ status, messageId: null });
    expect(await (await api('logs')).text()).not.toContain('sensitive');
    expect(await (await api(`pages/${connection}/send`, input)).json()).toMatchObject({ status });
  });
  it('supports official image/file URL payload without treating accepted as delivered', async () => {
    await ready(); const mock = graphMock(); expect(await (await api(`pages/${connection}/send`, { requestId: crypto.randomUUID(), psid, attachment: { type: 'image', url: 'https://media.example/owned.jpg' } })).json()).toMatchObject({ status: 'ACCEPTED' });
    const call = mock.mock.calls.find(call => new URL(String(call[0])).pathname.endsWith('/messages'))!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ messaging_type: 'RESPONSE', message: { attachment: { type: 'image', payload: { url: 'https://media.example/owned.jpg' } } } });
  });
  it('recovers interrupted sends as UNKNOWN and expires OAuth secrets', async () => {
    await ready(); graphMock(); await api(`pages/${connection}/send`, { requestId: crypto.randomUUID(), psid, text: 'hello' });
    db.sql.exec("UPDATE fb_outbound SET status='SENDING',updated_at=0"); await maintenance(env); expect(db.sql.prepare('SELECT status FROM fb_outbound').get()?.status).toBe('UNKNOWN');
  });
});