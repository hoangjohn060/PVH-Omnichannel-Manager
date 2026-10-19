import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrations } from '../../apps/desktop/electron/database/migrations';
import { parseIpc, settingsSchema } from '../../packages/shared/schemas';
import { isTrustedRenderer } from '../../apps/desktop/electron/security/policy';
import gateway from '../../apps/gateway/src';
describe('IPC allowlist and validation', () => {
  it('rejects unknown and inherited methods', () => { for (const key of ['fs:read', '__proto__', 'constructor']) expect(() => parseIpc(key, {})).toThrow('IPC_METHOD_NOT_ALLOWED'); });
  it('rejects unknown fields and wrong types', () => { expect(() => parseIpc('settings:update', { launchAtLogin: 'yes' })).toThrow(); expect(() => parseIpc('settings:update', { exec: 'calc' })).toThrow(); });
  it('accepts valid preferences', () => expect(parseIpc('settings:update', { theme: 'dark' })).toEqual({ theme: 'dark' }));
  it('uses safe defaults', () => expect(settingsSchema.parse({})).toMatchObject({ runInBackground: false, launchAtLogin: false, minimizeToTray: false }));
  it('rejects different file and dev origins', () => { expect(isTrustedRenderer('file:///evil.html', 'file:///app/index.html')).toBe(false); expect(isTrustedRenderer('http://evil.test/', 'http://127.0.0.1:5173/')).toBe(false); expect(isTrustedRenderer('file:///app/index.html#settings', 'file:///app/index.html')).toBe(true); });
});
describe('SQLite schema', () => {
  it('creates required tables and enforces relationships and transactions', () => {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
    for (const migration of migrations) db.transaction(() => db.exec(migration.sql))();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    for (const name of ['local_settings', 'cached_customers', 'cached_conversations', 'cached_messages', 'connector_sessions', 'pending_operations', 'sync_cursors', 'sync_outbox', 'audit_events']) expect(tables.some(t => t.name === name)).toBe(true);
    expect(() => db.prepare("INSERT INTO cached_messages VALUES ('1','missing','test','now','{}')").run()).toThrow();
    expect(() => db.transaction(() => { db.prepare("INSERT INTO cached_customers VALUES ('test','Test','{}','now')").run(); throw new Error('rollback'); })()).toThrow();
    expect(db.prepare('SELECT * FROM cached_customers').all()).toEqual([]); db.close();
  });
});
describe('Gateway boundary', () => {
  it('reports service health without claiming a Page connection and rejects unknown routes', async () => {
    expect(await (await gateway.fetch(new Request('https://local/health'))).json()).toMatchObject({ service: 'pvh-gateway', phase: 6, graphVersion: 'v26.0' });
    expect((await gateway.fetch(new Request('https://local/login', { method: 'POST' }))).status).toBe(404);
  });
});