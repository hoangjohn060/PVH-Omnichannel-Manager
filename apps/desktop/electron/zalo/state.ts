import type { ZaloState } from '@pvh/shared/types';
export type ZaloEvent = 'generate' | 'qr' | 'wait' | 'scan' | 'credentials' | 'connected' | 'reconnect' | 'expired' | 'error' | 'stop';
export function transition(state: ZaloState, event: ZaloEvent): ZaloState {
  if (event === 'stop') return 'DISCONNECTED';
  if (event === 'error') return 'ERROR';
  if (event === 'expired') return 'EXPIRED';
  if (event === 'generate' && ['DISCONNECTED', 'EXPIRED', 'ERROR'].includes(state)) return 'QR_GENERATING';
  if (event === 'qr' && state === 'QR_GENERATING') return 'QR_READY';
  if (event === 'wait' && state === 'QR_READY') return 'WAITING_SCAN';
  if (event === 'scan' && ['QR_READY', 'WAITING_SCAN'].includes(state)) return 'WAITING_CONFIRMATION';
  if (event === 'credentials' && state === 'WAITING_CONFIRMATION') return 'AUTHENTICATING';
  if (event === 'connected' && ['AUTHENTICATING', 'RECONNECTING'].includes(state)) return 'CONNECTED';
  if (event === 'reconnect' && ['CONNECTED', 'ERROR', 'DISCONNECTED', 'RECONNECTING'].includes(state)) return 'RECONNECTING';
  throw new Error('INVALID_ZALO_TRANSITION');
}
export const reconnectDelays = [5_000, 15_000, 45_000, 120_000, 300_000] as const;
export function backoff(attempt: number): number | null { return reconnectDelays[attempt] ?? null; }
export function classifyError(error: unknown): 'AUTH_EXPIRED' | 'NETWORK' | 'SDK_ERROR' {
  const text = error instanceof Error ? error.message : '';
  if (/proxy|tunnel|407/i.test(text)) return 'NETWORK';
  if (/unauthor|invalid.*(cookie|session|credential)|session.*(expired|revoked)|đăng nhập thất bại/i.test(text)) return 'AUTH_EXPIRED';
  if (/fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|abort|timeout/i.test(text)) return 'NETWORK';
  return 'SDK_ERROR';
}