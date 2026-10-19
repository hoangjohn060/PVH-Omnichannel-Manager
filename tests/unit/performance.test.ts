import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { migrations } from '../../apps/desktop/electron/database/migrations';
import { tuneDatabase } from '../../apps/desktop/electron/database/tuning';
import { zaloDatabaseOperation } from '../../apps/desktop/electron/database/zalo-repository';
import type { ZaloMessage } from '../../packages/shared/types';
import { redactLog } from '../../apps/desktop/electron/security/redaction';
import { isTrustedRenderer } from '../../apps/desktop/electron/security/policy';

it('redacts secrets while retaining actionable error codes', () => {
  const log = redactLog(new Error(`NETWORK password=secret cookie=session https://example.invalid/?token=secret Bearer abc ${'a'.repeat(64)}`));
  expect(log).toContain('NETWORK');
  for (const secret of ['secret', 'session', 'Bearer abc', 'a'.repeat(64)]) expect(log).not.toContain(secret);
});
it('rejects remote file hosts and embedded URL credentials', () => {
  expect(isTrustedRenderer('file://evil/app/index.html', 'file:///app/index.html')).toBe(false);
  expect(isTrustedRenderer('http://user:pass@localhost:5173/', 'http://localhost:5173/')).toBe(false);
});
it('persists 10,000 messages, 100 threads and a 100+20 duplicate burst; bounded indexed reads survive restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pvh-stress-'));
  let db = new Database(join(directory, 'stress.sqlite'));
  try {
    tuneDatabase(db);
    for (const migration of migrations) db.exec(migration.sql);
    db.prepare("INSERT INTO zalo_accounts(id,label,owner_id) VALUES('stress','Test only','test')").run();
    const message = (i: number): ZaloMessage => ({ platform: 'zalo', accountId: 'stress', messageId: String(i), threadId: String(i % 100), threadType: 0, timestamp: 1_790_000_000_000 + i, text: `Test message ${i} Tiếng Việt`, senderId: 'test', senderName: 'Test', isSelf: false, kind: 'text', agentId: null, status: 'RECEIVED', attachment: null });
    const start = performance.now();
    for (let i = 0; i < 10_000; i += 100) zaloDatabaseOperation(db, 'zalo:messages-batch', Array.from({ length: 100 }, (_, j) => message(i + j)));
    const seedMs = performance.now() - start;
    const burst = Array.from({ length: 100 }, (_, i) => message(10_000 + i));
    const burstStart = performance.now();
    zaloDatabaseOperation(db, 'zalo:messages-batch', burst);
    zaloDatabaseOperation(db, 'zalo:messages-batch', burst.slice(0, 20));
    const burstMs = performance.now() - burstStart;
    for (const table of ['zalo_messages', 'zalo_gateway_outbox', 'inbox_connector_outbox']) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 10_100 });
    expect((zaloDatabaseOperation(db, 'zalo:threads', { accountId: 'stress' }) as unknown[]).length).toBe(100);
    const times = Array.from({ length: 100 }, (_, i) => {
      const before = performance.now();
      const rows = zaloDatabaseOperation(db, 'zalo:messages', { accountId: 'stress', threadId: String(i) }) as ZaloMessage[];
      expect(rows.length).toBe(101); expect(rows[0]!.timestamp).toBeLessThan(rows.at(-1)!.timestamp);
      return performance.now() - before;
    }).sort((a, b) => a - b);
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT payload FROM zalo_messages WHERE account_id=? AND thread_id=? ORDER BY timestamp DESC LIMIT 200').all('stress', '0');
    expect(JSON.stringify(plan)).toContain('idx_zalo_messages_thread');
    expect(zaloDatabaseOperation(db, 'zalo:messages', { accountId: "' OR 1=1 --", threadId: '0' })).toEqual([]);
    // A failing row must roll back the entire batch, including its outboxes.
    expect(() => zaloDatabaseOperation(db, 'zalo:messages-batch', [message(20_000), { ...message(20_001), accountId: 'missing' }])).toThrow();
    expect(db.prepare("SELECT 1 FROM zalo_messages WHERE message_id='20000'").get()).toBeUndefined();
    expect(() => zaloDatabaseOperation(db, 'zalo:messages-batch', Array(101).fill(message(0)))).toThrow('INVALID_MESSAGE_BATCH');
    db.close(); db = new Database(join(directory, 'stress.sqlite')); tuneDatabase(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM zalo_messages').get()).toEqual({ n: 10_100 });
    expect(db.pragma('quick_check', { simple: true })).toBe('ok');
    mkdirSync('artifacts', { recursive: true });
    writeFileSync('artifacts/phase07-database.json', JSON.stringify({ measuredAt: new Date().toISOString(), runtime: process.versions, seedMs, burstMs, queryP50Ms: times[50], queryP95Ms: times[95], plan, pragmas: { cache: db.pragma('cache_size', { simple: true }), synchronous: db.pragma('synchronous', { simple: true }) } }, null, 2));
  } finally { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); }
}, 30_000);