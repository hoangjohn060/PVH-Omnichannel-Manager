import type { ZaloCredentials } from "./types.js";

/**
 * Conservative auth-error classifier for a zca-js login rejection.
 * Returns true ONLY when the message clearly indicates a credential/session problem.
 * Everything else (network, unknown) is treated as retryable — a wrong `expired`
 * forces a manual QR re-scan, while a wrong retry only costs a backoff delay.
 */
export function isZaloAuthError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? "").toLowerCase();
  if (!msg) return false;
  // Proxy/tunnel failures (e.g. "407 Proxy Authentication Required") are NOT Zalo credential
  // problems — they're proxy misconfig/network. Treat as retryable (network path), not `expired`.
  if (/proxy|tunnel|407/.test(msg)) return false;
  return /cookie|credential|unauthor|đăng nhập|(login|session|token).*(fail|expired|invalid|reject)|(invalid|expired|reject).*(login|session|token)/.test(
    msg,
  );
}

export interface EventLogLike {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** The slice of an adapter the supervisor drives. ZcaAdapter satisfies it structurally. */
export interface SupervisedAdapter {
  onClosed(cb: (code: number, reason: string) => void): void;
  getSerializedCookie(): unknown;
  stop(): Promise<void>;
}

/** All I/O the supervisor needs, injected so it stays unit-testable. */
export interface ReconnectDeps {
  loadCredentials(accountId: number): Promise<ZaloCredentials | null>;
  saveCredentials(accountId: number, creds: ZaloCredentials): Promise<void>;
  createAdapter(accountId: number, creds: ZaloCredentials): Promise<SupervisedAdapter>;
  isAuthError(err: unknown): boolean;
  register(accountId: number, adapter: SupervisedAdapter): void;
  unregister(accountId: number): Promise<void>;
  bindInbound(accountId: number): void;
  setStatus(accountId: number, status: "connected" | "reconnecting" | "expired"): Promise<void>;
  schedule(fn: () => void | Promise<void>, ms: number): { cancel: () => void };
  log: EventLogLike;
}

// Exponential backoff (ms); the last value is the cap.
export const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000];
const MANUAL_CLOSE = 1000;

interface AccountState {
  attempt: number;
  connecting: boolean;
  stopped: boolean;
  epoch: number;
  adapter?: SupervisedAdapter;
  timer?: { cancel: () => void };
}

export class ReconnectSupervisor {
  private state = new Map<number, AccountState>();

  constructor(private deps: ReconnectDeps) {}

  /** Re-persist the live cookie for every currently-connected account. Never throws. */
  async persistAllCookies(): Promise<void> {
    for (const [accountId, st] of this.state) {
      if (!st.adapter) continue;
      try {
        const creds = await this.deps.loadCredentials(accountId);
        if (creds) await this.persistCookie(accountId, st.adapter, creds);
      } catch (err) {
        this.deps.log.warn({ event: "zalo_cookie_persist_failed", accountId, err }, "failed to persist refreshed cookie");
      }
    }
  }

  /** Stop supervising an account (deleted / logged out by the operator). Cancels any pending reconnect. */
  async remove(accountId: number): Promise<void> {
    const st = this.ensure(accountId);
    st.stopped = true;
    st.epoch++; // supersede any in-flight connect() for this removed account
    st.timer?.cancel();
    st.timer = undefined;
    st.adapter = undefined;
    await this.deps.unregister(accountId).catch(() => {});
  }

  /** Connect (or reconnect) one personal account. Never throws. */
  async connect(accountId: number): Promise<void> {
    const st = this.ensure(accountId);
    if (st.connecting) return; // guard against overlapping attempts
    st.connecting = true;
    st.stopped = false;
    const epoch = ++st.epoch; // this attempt's generation; onClosed/remove bump st.epoch to supersede it
    const isCurrent = () => st.epoch === epoch && !st.stopped;
    try {
      const creds = await this.deps.loadCredentials(accountId);
      // No stored credentials yet (or they were deleted). Nothing to restore; leave status as-is —
      // we never auto-mark `expired` here because a freshly-created account legitimately has none.
      if (!creds || !isCurrent()) return;
      const adapter = await this.deps.createAdapter(accountId, creds); // may throw
      if (!isCurrent()) { await adapter.stop().catch(() => {}); return; }
      this.deps.register(accountId, adapter);
      this.deps.bindInbound(accountId);
      adapter.onClosed((code, reason) => this.onClosed(accountId, code, reason));
      st.adapter = adapter;
      st.attempt = 0;
      await this.transition(accountId, "connected");
      if (!isCurrent()) return; // a close interleaved during setStatus; onClosed already handled it
      await this.persistCookie(accountId, adapter, creds);
    } catch (err) {
      st.adapter = undefined;
      if (this.deps.isAuthError(err)) {
        this.deps.log.warn({ event: "zalo_auth_failed", accountId, err }, "zalo re-login auth failure; marking expired");
        await this.transition(accountId, "expired");
        return;
      }
      this.deps.log.warn({ event: "zalo_connect_failed", accountId, err }, "zalo connect failed; will retry");
      await this.transition(accountId, "reconnecting");
      this.scheduleReconnect(accountId);
    } finally {
      st.connecting = false;
    }
  }

  /** Single choke point for status changes: emit an account_status event, then persist the status. */
  private async transition(accountId: number, status: "connected" | "reconnecting" | "expired"): Promise<void> {
    this.deps.log.info({ event: "account_status", accountId, status }, "account status changed");
    await this.deps.setStatus(accountId, status);
  }

  private async persistCookie(accountId: number, adapter: SupervisedAdapter, creds: ZaloCredentials): Promise<void> {
    try {
      const cookie = adapter.getSerializedCookie();
      if (cookie == null) return;
      await this.deps.saveCredentials(accountId, { ...creds, cookie });
    } catch (err) {
      this.deps.log.warn({ event: "zalo_cookie_persist_failed", accountId, err }, "failed to persist refreshed cookie");
    }
  }

  private ensure(accountId: number): AccountState {
    let s = this.state.get(accountId);
    if (!s) {
      s = { attempt: 0, connecting: false, stopped: false, epoch: 0 };
      this.state.set(accountId, s);
    }
    return s;
  }

  private onClosed(accountId: number, code: number, reason: string): void {
    const st = this.ensure(accountId);
    st.adapter = undefined;
    st.epoch++; // supersede any in-flight connect() so it won't overwrite status back to connected
    if (st.stopped) return;
    if (code === MANUAL_CLOSE) return; // we closed it on purpose
    this.deps.log.warn({ event: "zalo_session_closed", accountId, code, reason }, "zalo session closed; scheduling reconnect");
    void this.deps.unregister(accountId).catch(() => {});
    void this.transition(accountId, "reconnecting").catch(() => {});
    this.scheduleReconnect(accountId);
  }

  private scheduleReconnect(accountId: number): void {
    const st = this.ensure(accountId);
    st.timer?.cancel();
    const ms = BACKOFF_MS[Math.min(st.attempt, BACKOFF_MS.length - 1)];
    st.attempt++;
    st.timer = this.deps.schedule(async () => {
      st.timer = undefined;
      if (st.stopped) return;
      await this.connect(accountId);
    }, ms);
  }
}
