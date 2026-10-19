vi.mock('../../apps/desktop/electron/auth/connector', () => ({ connectorLease: () => ({ ensure: async () => {}, register: async () => {}, bind: async () => {} }) }));
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { migrations } from '../../apps/desktop/electron/database/migrations';
import { zaloDatabaseOperation } from '../../apps/desktop/electron/database/zalo-repository';
import type { DatabaseClient } from '../../apps/desktop/electron/database/client';
const mocks = vi.hoisted(() => ({ workers: [] as EventEmitter[] }));
vi.mock('node:worker_threads', () => ({ Worker: class extends EventEmitter {
  stdout = { resume() {} }; stderr = { resume() {} }; commands: unknown[] = [];
  constructor() { super(); mocks.workers.push(this); }
  postMessage(command: { type: string }) { this.commands.push(command); if (command.type === 'stop') queueMicrotask(() => this.emit('message', { type: 'stopped' })); }
  async terminate() { this.emit('exit', 1); return 1; }
} }));
// Unit seam only. Actual DPAPI is tested in Electron E2E; this mock is NOT an encryption proof.
vi.mock('../../apps/desktop/electron/security/secrets', () => ({ encryptSecret: (text: string) => Buffer.from(text), decryptSecret: (bytes: Buffer) => bytes.toString() }));
import { ZaloSupervisor } from '../../apps/desktop/electron/zalo/supervisor';
let db: Database.Database; let supervisor: ZaloSupervisor; let directory: string;
async function settle() { for (let n = 0; n < 30; n++) await Promise.resolve(); }
beforeEach(async () => {
  mocks.workers.length = 0; directory = mkdtempSync(join(tmpdir(), 'pvh-supervisor-')); db = new Database(':memory:'); db.pragma('foreign_keys=ON'); for (const migration of migrations) db.exec(migration.sql);
  const client = { call: async (method: string, payload: unknown) => zaloDatabaseOperation(db, method, payload) } as unknown as DatabaseClient;
  supervisor = new ZaloSupervisor(client, directory, () => {}); await supervisor.initialize();
});
afterEach(async () => { await supervisor.close(); db.close(); rmSync(directory, { recursive: true, force: true }); vi.useRealTimers(); });
async function connectFixture() {
  const account = await supervisor.add('UNIT FIXTURE — not a real account'); const worker = mocks.workers[0]!;
  worker.emit('message', { type: 'state', event: 'error' }); await settle();
  // Restart in restore mode with a test-only session, avoiding synthetic QR imagery.
  db.prepare('UPDATE zalo_accounts SET encrypted_session=? WHERE id=?').run(Buffer.from(JSON.stringify({ cookie: [], imei: 'unit-test', userAgent: 'unit-test' })), account.id);
  (supervisor as unknown as { accounts: Map<string, { hasSession: boolean }> }).accounts.get(account.id)!.hasSession = true;
  await supervisor.action(account.id, 'reconnect');
  const restored = mocks.workers.at(-1)!;
  restored.emit('message', { type: 'identity', uid: '123456' });
  restored.emit('message', { type: 'state', event: 'connected' }); await settle();
  expect((await supervisor.snapshot()).accounts[0]!.state).toBe('CONNECTED');
  return { account, worker: restored };
}
describe('Supervisor isolated fixtures — NOT live login', () => {
  it('persists a verified worker burst and 20 duplicates without extra rows', async () => {
    const { account, worker } = await connectFixture();
    const messages = Array.from({ length: 100 }, (_, i) => ({ platform: 'zalo', accountId: account.id, messageId: String(i), threadId: '1', threadType: 0, senderId: '2', senderName: 'Test', isSelf: false, agentId: null, text: 'Test', timestamp: i + 1, kind: 'text', attachment: null, status: 'RECEIVED' }));
    worker.emit('message', { type: 'messages', messages });
    worker.emit('message', { type: 'messages', messages: messages.slice(0, 20) }); await settle();
    expect(db.prepare('SELECT COUNT(*) AS n FROM zalo_messages').get()).toEqual({ n: 100 });
    expect((await supervisor.snapshot()).accounts[0]!.state).toBe('CONNECTED');
  });
  it('cancels QR and ignores late worker events without reviving a listener', async () => {
    const account = await supervisor.add('Fixture'); const old = mocks.workers[0]!;
    await supervisor.action(account.id, 'cancel'); old.emit('message', { type: 'state', event: 'connected' }); await settle();
    expect((await supervisor.snapshot()).accounts[0]).toMatchObject({ state: 'DISCONNECTED', qr: null, hasSession: false });
  });
  it('recovers a crashed session only after backoff and stops competing on duplicate', async () => {
    const { worker } = await connectFixture(); vi.useFakeTimers();
    worker.emit('error', new Error('UNIT CRASH cookie=DO_NOT_LOG')); worker.emit('exit', 1); await settle();
    expect((await supervisor.snapshot()).accounts[0]).toMatchObject({ state: 'RECONNECTING', reconnectAttempt: 1 });
    const count = mocks.workers.length;
    await vi.advanceTimersByTimeAsync(4999); expect(mocks.workers.length).toBe(count);
    await vi.advanceTimersByTimeAsync(1); await settle(); expect(mocks.workers.length).toBe(count + 1);
    mocks.workers.at(-1)!.emit('message', { type: 'failure', code: 'DUPLICATE_LISTENER', expired: false, retryable: false }); await settle();
    expect((await supervisor.snapshot()).accounts[0]!.state).toBe('ERROR');
    await vi.advanceTimersByTimeAsync(600000); expect(mocks.workers.length).toBe(count + 1);
    expect(JSON.stringify((await supervisor.snapshot()).logs)).not.toContain('DO_NOT_LOG');
  });
  it('purges revoked session and never retries it as connected', async () => {
    const { worker } = await connectFixture();
    worker.emit('message', { type: 'failure', code: 'AUTH_EXPIRED', expired: true, retryable: false }); await settle();
    expect((await supervisor.snapshot()).accounts[0]).toMatchObject({ state: 'EXPIRED', hasSession: false });
    expect((db.prepare('SELECT encrypted_session AS secret FROM zalo_accounts').get() as { secret: unknown }).secret).toBeNull();
  });
  it('records failed send and never reports SENT or retries the same request id', async () => {
    const { account, worker } = await connectFixture();
    const input = { accountId: account.id, threadId: '987', threadType: 0 as const, text: 'Tin unit test', requestId: crypto.randomUUID() };
    const pending = supervisor.send(input); const rejection = expect(pending).rejects.toThrow(); await settle();
    worker.emit('message', { type: 'send-failed', requestId: input.requestId, code: 'SEND_FAILED_OR_UNCONFIRMED' }); await settle(); await rejection;
    expect((await supervisor.snapshot()).failures).toMatchObject([{ status: 'UNKNOWN', attempts: 1 }]);
    await expect(supervisor.send(input)).rejects.toThrow('REQUEST_ALREADY_ATTEMPTED');
    expect(db.prepare('SELECT COUNT(*) AS n FROM zalo_messages').get()).toEqual({ n: 0 });
  });
});