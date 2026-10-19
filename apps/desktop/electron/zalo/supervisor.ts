import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, openSync, closeSync, rmSync, writeSync, readFileSync } from 'node:fs';
import type { Credentials } from 'zca-js';
import type { ZaloAccount, ZaloFailure, ZaloLog, ZaloMessage, ZaloSendInput, ZaloSnapshot } from '@pvh/shared/types';
import type { DatabaseClient } from '../database/client';
import { encryptSecret, decryptSecret } from '../security/secrets';
import { backoff, transition, type ZaloEvent } from './state';
import { pngDataUrl } from './mapping';
import type { WorkerCommand, WorkerEvent } from './protocol';
import { connectorLease } from '../auth/connector';

interface Runtime { worker?: Worker; epoch: number; timer?: NodeJS.Timeout; watchdog?: NodeJS.Timeout; attempt: number; stopped: boolean; verifiedUid?: boolean; stopAck?: () => void; serial: Promise<void> }
interface SendTask { input: ZaloSendInput; resolve: (value: { messageId: string }) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
const errorText: Record<string, string> = {
  AUTH_EXPIRED: 'Phiên không hợp lệ hoặc đã hết hạn. Hãy quét lại QR.', SESSION_KICKED: 'Phiên bị thu hồi. Hãy quét lại QR.',
  DUPLICATE_LISTENER: 'Có listener khác cho tài khoản này. Đã dừng; không tự tranh kết nối.',
  NETWORK: 'Lỗi mạng hoặc timeout. Kết nối lại có giới hạn và backoff.', SDK_ERROR: 'SDK không hoàn tất thao tác. Hãy thử lại có chủ đích.',
  WORKER_CRASH: 'Connector đã dừng bất thường; ứng dụng vẫn hoạt động.', RETRIES_EXHAUSTED: 'Đã hết số lần thử tự động. Hãy kiểm tra mạng rồi kết nối lại.',
  SESSION_STORE_FAILED: 'Không thể lưu phiên mã hóa. Connector đã dừng.', DUPLICATE_ACCOUNT: 'Tài khoản Zalo này đã có connector chủ sở hữu trên máy.',
};
export class ZaloSupervisor {
  private accounts = new Map<string, ZaloAccount>();
  private runtimes = new Map<string, Runtime>();
  private sends = new Map<string, SendTask>();
  private commands = new Map<string, Promise<unknown>>();
  private ownerId: string;
  private lockFd: number;
  private refresh: NodeJS.Timeout;
  private closing = false;
  constructor(private database: DatabaseClient, private directory: string, private changed: () => void) {
    // One local userData owner; this is NOT a distributed lock. Other PCs must use Phase 06 Gateway.
    const ownerFile = join(directory, 'connector-owner.json');
    try { this.ownerId = String((JSON.parse(readFileSync(ownerFile, 'utf8')) as { id: string }).id); }
    catch { this.ownerId = randomUUID(); const fd = openSync(ownerFile, 'w'); writeSync(fd, JSON.stringify({ id: this.ownerId })); closeSync(fd); }
    mkdirSync(join(directory, 'connector-locks'), { recursive: true });
    const lockPath = join(directory, 'connector-locks', 'zalo.lock');
    try { this.lockFd = openSync(lockPath, 'wx'); }
    catch {
      const pid = Number(readFileSync(lockPath, 'utf8')); let alive = true;
      try { process.kill(pid, 0); } catch { alive = false; }
      if (alive) throw new Error('CONNECTOR_OWNER_LOCKED');
      rmSync(lockPath); this.lockFd = openSync(lockPath, 'wx');
    }
    writeSync(this.lockFd, String(process.pid));
    this.refresh = setInterval(() => { for (const runtime of this.runtimes.values()) runtime.worker?.postMessage({ type: 'persist' } satisfies WorkerCommand); }, 5 * 60_000);
  }
  async initialize(): Promise<void> {
    await this.database.call('zalo:recover-outbound', {});
    const rows = await this.database.call<ZaloAccount[]>('zalo:list', {});
    for (const row of rows) {
      this.accounts.set(row.id, { ...row, hasSession: Boolean(row.hasSession), state: 'DISCONNECTED', qr: null, expiresAt: null, error: null, reconnectAttempt: 0 });
      this.runtimes.set(row.id, { epoch: 0, attempt: 0, stopped: true, serial: Promise.resolve() });
      await this.database.call('zalo:state', { id: row.id, state: 'DISCONNECTED' });
    }
    // Explicit disconnect remains disconnected across restarts; only active persisted sessions resume.
    for (const row of rows) if (row.hasSession && ['CONNECTED', 'RECONNECTING', 'AUTHENTICATING'].includes(row.state)) void this.action(row.id, 'reconnect').catch(() => {});
  }
  connectedCount(): number { return [...this.accounts.values()].filter(account => account.state === 'CONNECTED').length; }
  async snapshot(): Promise<ZaloSnapshot> { return { accounts: [...this.accounts.values()].map(account => ({ ...account })), logs: await this.database.call<ZaloLog[]>('zalo:logs', {}), failures: await this.database.call<ZaloFailure[]>('zalo:failures', {}) }; }
  async add(label: string): Promise<ZaloAccount> {
    if (this.closing || this.accounts.size >= 10) throw new Error('ACCOUNT_LIMIT');
    const id = randomUUID();
    await this.database.call('zalo:add', { id, label, ownerId: this.ownerId });
    const account: ZaloAccount = { id, label, uid: null, displayName: null, avatar: null, ownerId: this.ownerId, state: 'DISCONNECTED', qr: null, expiresAt: null, error: null, reconnectAttempt: 0, hasSession: false };
    this.accounts.set(id, account); this.runtimes.set(id, { epoch: 0, attempt: 0, stopped: true, serial: Promise.resolve() });
    this.changed();
    await this.action(id, 'qr'); return { ...account };
  }
  private require(id: string): { account: ZaloAccount; runtime: Runtime } {
    const account = this.accounts.get(id); const runtime = this.runtimes.get(id);
    if (!account || !runtime || account.ownerId !== this.ownerId) throw new Error('ACCOUNT_NOT_OWNED');
    return { account, runtime };
  }
  private async state(id: string, event: ZaloEvent): Promise<void> {
    const { account } = this.require(id);
    account.state = transition(account.state, event);
    if (!['QR_READY', 'WAITING_SCAN'].includes(account.state)) account.qr = null;
    if (account.state === 'CONNECTED') { account.error = null; clearTimeout(this.require(id).runtime.watchdog); }
    await this.database.call('zalo:state', { id, state: account.state });
    this.changed();
  }
  private async log(id: string, code: string): Promise<void> { await this.database.call('zalo:log', { id, code }); this.changed(); }
  async action(id: string, action: 'qr' | 'cancel' | 'disconnect' | 'reconnect'): Promise<boolean> {
    this.require(id);
    const previous = this.commands.get(id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      if (this.closing) throw new Error('APP_CLOSING');
      await this.stop(id);
      const { account, runtime } = this.require(id);
      await this.state(id, 'stop');
      account.error = null; runtime.attempt = 0; account.reconnectAttempt = 0;
      if (action === 'disconnect' || action === 'cancel') return true;
      runtime.stopped = false;
      if (action === 'qr') {
        await this.database.call('zalo:save-session', { id, session: null }); account.hasSession = false;
        await this.state(id, 'generate'); await this.spawn(id, { type: 'qr' });
      } else {
        if (!account.hasSession) { account.error = 'Chưa có phiên đã lưu. Hãy đăng nhập QR.'; await this.state(id, 'expired'); return true; }
        await this.restore(id);
      }
      return true;
    });
    this.commands.set(id, task);
    try { return await task; } finally { if (this.commands.get(id) === task) this.commands.delete(id); }
  }
  private async restore(id: string): Promise<void> {
    const { runtime } = this.require(id); if (runtime.stopped || this.closing) return;
    const bytes = await this.database.call<Uint8Array | null>('zalo:session', { id });
    if (!bytes) { await this.state(id, 'expired'); return; }
    let credentials: Credentials;
    try { credentials = JSON.parse(decryptSecret(Buffer.from(bytes))) as Credentials; if (!credentials.cookie || !credentials.imei || !credentials.userAgent) throw new Error('INVALID_SESSION'); }
    catch { await this.failure(id, { type: 'failure', code: 'AUTH_EXPIRED', expired: true, retryable: false }); return; }
    await this.state(id, 'reconnect');
    await this.spawn(id, { type: 'restore', credentials });
  }
  private async spawn(id: string, command: WorkerCommand): Promise<void> {
    const { runtime } = this.require(id);
    if (runtime.worker || runtime.stopped) return;
    await connectorLease().register(id,this.require(id).account.label);
    await connectorLease().ensure(id);
    const epoch = ++runtime.epoch;
    const worker = new Worker(join(__dirname, 'zalo-worker.js'), { workerData: { accountId: id }, stdout: true, stderr: true });
    // Consume SDK output without logging it: upstream exceptions could contain credentials.
    worker.stdout?.resume(); worker.stderr?.resume();
    runtime.worker = worker; runtime.verifiedUid = false;
    worker.on('message', (message: WorkerEvent) => {
      if (message.type === 'stopped') { runtime.stopAck?.(); return; }
      runtime.serial = runtime.serial.then(async () => { if (runtime.epoch === epoch && !runtime.stopped) await this.handle(id, message); }).catch(async () => {
        if (runtime.epoch === epoch && !runtime.stopped) await this.failure(id, { type: 'failure', code: 'SESSION_STORE_FAILED', expired: false, retryable: false });
      });
    });
    const crashed = (): void => {
      if (runtime.epoch !== epoch || runtime.stopped) return;
      runtime.serial = runtime.serial.then(async () => { if (runtime.epoch === epoch && !runtime.stopped) await this.failure(id, { type: 'failure', code: 'WORKER_CRASH', expired: false, retryable: this.accounts.get(id)?.hasSession ?? false }); }).catch(() => {});
    };
    worker.on('error', crashed); worker.on('exit', crashed);
    runtime.watchdog = setTimeout(() => { if (runtime.epoch === epoch) void this.failure(id, { type: 'failure', code: 'NETWORK', expired: false, retryable: command.type === 'restore' }); }, command.type === 'qr' ? 150_000 : 90_000);
    worker.postMessage(command);
  }
  private async handle(id: string, message: WorkerEvent): Promise<void> {
    const { account, runtime } = this.require(id);
    switch (message.type) {
      case 'qr': account.qr = pngDataUrl(message.image); await this.state(id, 'qr'); await this.state(id, 'wait'); break;
      case 'state':
        if (message.event === 'connected' && account.state === 'CONNECTED') break;
        if (message.event === 'connected') { if (!runtime.verifiedUid) throw new Error('IDENTITY_NOT_VERIFIED'); runtime.attempt = 0; account.reconnectAttempt = 0; }
        await this.state(id, message.event);
        if (message.event === 'expired') { await this.stop(id); await this.log(id, 'QR_EXPIRED'); }
        break;
      case 'profile': {
        account.displayName = message.displayName.slice(0, 120);
        // No remote URLs enter the renderer. Avatar displayed only when SDK supplies data PNG/JPEG.
        account.avatar = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(message.avatar) && message.avatar.length < 500_000 ? message.avatar : null;
        await this.database.call('zalo:profile', { id, displayName: account.displayName, avatar: account.avatar }); this.changed(); break;
      }
      case 'identity':
        await connectorLease().bind(id,message.uid);
        if ([...this.accounts.values()].some(other => other.id !== id && other.uid === message.uid)) { await this.failure(id, { type: 'failure', code: 'DUPLICATE_ACCOUNT', expired: false, retryable: false }); await this.database.call('zalo:save-session', { id, session: null }); account.hasSession = false; this.changed(); return; }
        if (account.uid && account.uid !== message.uid) { await this.failure(id, { type: 'failure', code: 'ACCOUNT_IDENTITY_CHANGED', expired: true, retryable: false }); return; }
        account.uid = message.uid; runtime.verifiedUid = true; await this.database.call('zalo:identity', { id, uid: message.uid });
        runtime.worker?.postMessage({type:'identity-saved'} satisfies WorkerCommand);break;
      case 'session': {
        const encrypted = encryptSecret(JSON.stringify(message.credentials));
        await this.database.call('zalo:save-session', { id, session: encrypted }); account.hasSession = true;
        runtime.worker?.postMessage({ type: 'session-saved' } satisfies WorkerCommand); break;
      }
      case 'messages':
        if (!runtime.verifiedUid || message.messages.length > 100 || message.messages.some(item => item.accountId !== id)) throw new Error('ACCOUNT_MISMATCH');
        await this.database.call('zalo:messages-batch', message.messages); this.changed(); break;
      case 'message': if (!runtime.verifiedUid || message.message.accountId !== id) throw new Error('ACCOUNT_MISMATCH'); await this.database.call('zalo:message', message.message); this.changed(); break;
      case 'delivery': await this.database.call('zalo:delivery', { accountId: id, messageIds: message.messageIds, status: message.status }); this.changed(); break;
      case 'sent': case 'send-failed': await this.completeSend(id, message); break;
      case 'failure': await this.failure(id, message); break;
      case 'stopped': break;
    }
  }
  private async failure(id: string, failure: Extract<WorkerEvent, { type: 'failure' }>): Promise<void> {
    const { account, runtime } = this.require(id);
    // Normalization errors affect one message, not the whole connector.
    if (failure.code === 'MESSAGE_NORMALIZE_FAILED') { await this.log(id, failure.code); return; }
    await this.stop(id);
    account.error = errorText[failure.code] ?? 'Connector gặp lỗi. Xem mã lỗi trong nhật ký.';
    await this.log(id, failure.code);
    if (failure.expired) { await this.database.call('zalo:save-session', { id, session: null }); account.hasSession = false; await this.state(id, 'expired'); return; }
    if (!failure.retryable || !account.hasSession || this.closing) { await this.state(id, 'error'); return; }
    const delay = backoff(runtime.attempt++);
    account.reconnectAttempt = runtime.attempt;
    if (delay === null) { account.error = errorText.RETRIES_EXHAUSTED!; await this.log(id, 'RETRIES_EXHAUSTED'); await this.state(id, 'error'); return; }
    await this.state(id, 'error'); await this.state(id, 'reconnect'); runtime.stopped = false;
    runtime.timer = setTimeout(() => { runtime.timer = undefined; void this.restore(id).catch(() => {}); }, delay);
  }
  private async stop(id: string): Promise<void> {
    const { runtime } = this.require(id);
    runtime.stopped = true; runtime.epoch++; clearTimeout(runtime.timer); clearTimeout(runtime.watchdog);
    const worker = runtime.worker; runtime.worker = undefined;
    if (worker) {
      // The normal epoch guard rejects old events. Capture only this terminating
      // worker's final cookie refresh, encrypt it immediately and wait for disk persistence.
      const finalSessions: Promise<unknown>[] = [];
      const captureSession = (message: WorkerEvent): void => {
        if (message.type === 'messages' && runtime.verifiedUid && message.messages.length <= 100 && message.messages.every(item => item.accountId === id)) {
          finalSessions.push(this.database.call('zalo:messages-batch', message.messages));
        }
        if (message.type === 'session') {
          try { const session = encryptSecret(JSON.stringify(message.credentials)); finalSessions.push(this.database.call('zalo:save-session', { id, session })); }
          catch { /* Existing encrypted session is retained; do not log raw credentials. */ }
        }
      };
      worker.on('message', captureSession);
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 1500); runtime.stopAck = () => { clearTimeout(timer); resolve(); }; worker.postMessage({ type: 'stop' } satisfies WorkerCommand); });
      runtime.stopAck = undefined; await worker.terminate(); worker.removeListener('message', captureSession);
      await Promise.allSettled(finalSessions);
    }
    for (const [requestId, task] of this.sends) if (task.input.accountId === id) { clearTimeout(task.timer); this.sends.delete(requestId); await this.database.call('zalo:outbound-result', { accountId: id, requestId, status: 'UNKNOWN', error: 'CONNECTOR_STOPPED_SEND_UNCONFIRMED' }); task.reject(new Error('Kết quả gửi chưa xác định; không tự gửi lại để tránh trùng.')); }
  }
  async send(input: ZaloSendInput): Promise<{ messageId: string }> {
    await connectorLease().ensure(input.accountId);
    const { account, runtime } = this.require(input.accountId);
    if (account.state !== 'CONNECTED' || !runtime.worker) throw new Error('ZALO_NOT_CONNECTED');
    if (this.sends.has(input.requestId)) throw new Error('REQUEST_IN_PROGRESS');
    if (this.sends.size >= 20) throw new Error('SEND_QUEUE_LIMIT');
    const worker = runtime.worker; const epoch = runtime.epoch;
    const previous = await this.database.call<{ accountId: string; threadId: string; text: string; status: string; messageId: string | null; inserted: boolean }>('zalo:outbound-begin', input);
    if (previous.accountId !== input.accountId || previous.threadId !== input.threadId || previous.text !== input.text) throw new Error('REQUEST_ID_CONFLICT');
    if (previous.status === 'SENT' && previous.messageId) return { messageId: previous.messageId };
    // A given idempotency key is transmitted at most once. No blind retry after timeout.
    if (!previous.inserted || previous.status !== 'SENDING') throw new Error('REQUEST_ALREADY_ATTEMPTED');
    if (runtime.worker !== worker || runtime.epoch !== epoch || runtime.stopped) {
      await this.database.call('zalo:outbound-result', { accountId: input.accountId, requestId: input.requestId, status: 'FAILED', error: 'DISCONNECTED_BEFORE_SEND' });
      throw new Error('DISCONNECTED_BEFORE_SEND');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void this.completeSend(input.accountId, { type: 'send-failed', requestId: input.requestId, code: 'SEND_TIMEOUT_UNCONFIRMED' }); }, 40_000);
      this.sends.set(input.requestId, { input, resolve, reject, timer });
      worker.postMessage({ type: 'send', input } satisfies WorkerCommand);
    });
  }
  private async completeSend(accountId: string, result: Extract<WorkerEvent, { type: 'sent' | 'send-failed' }>): Promise<void> {
    const task = this.sends.get(result.requestId);
    if (!task || task.input.accountId !== accountId) return;
    clearTimeout(task.timer); this.sends.delete(result.requestId);
    try {
      if (result.type === 'sent') {
        const account = this.require(accountId).account;
        const message: ZaloMessage = { platform: 'zalo', accountId, messageId: result.messageId, threadId: task.input.threadId, threadType: task.input.threadType, senderId: account.uid!, senderName: account.displayName ?? '', isSelf: true, agentId: null, text: task.input.text, timestamp: Date.now(), kind: 'text', attachment: null, status: 'SENT' };
        await this.database.call('zalo:message', message);
        await this.database.call('zalo:outbound-result', { accountId, requestId: result.requestId, status: 'SENT', messageId: result.messageId });
        task.resolve({ messageId: result.messageId });
      } else {
        await this.database.call('zalo:outbound-result', { accountId, requestId: result.requestId, status: result.code.includes('TIMEOUT') || result.code.includes('UNCONFIRMED') ? 'UNKNOWN' : 'FAILED', error: result.code });
        task.reject(new Error('Gửi thất bại hoặc chưa xác định. Không tự động gửi lại.'));
      }
    } catch { task.reject(new Error('Không thể lưu kết quả gửi. Kiểm tra hội thoại trước khi gửi lại.')); }
    this.changed();
  }
  async close(): Promise<void> {
    this.closing = true; clearInterval(this.refresh);
    await Promise.all([...this.commands.values()].map(task => task.catch(() => {})));
    await Promise.all([...this.runtimes.keys()].map(id => this.stop(id)));
    closeSync(this.lockFd); rmSync(join(this.directory, 'connector-locks', 'zalo.lock'), { force: true });
  }
}