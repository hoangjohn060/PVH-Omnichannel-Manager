export const zaloStates = ['DISCONNECTED', 'QR_GENERATING', 'QR_READY', 'WAITING_SCAN', 'WAITING_CONFIRMATION', 'AUTHENTICATING', 'CONNECTED', 'RECONNECTING', 'EXPIRED', 'ERROR'] as const;
export type ZaloState = typeof zaloStates[number];
export interface ZaloAccount {
  id: string; label: string; uid: string | null; displayName: string | null; avatar: string | null;
  ownerId: string; state: ZaloState; qr: string | null; expiresAt: number | null;
  error: string | null; reconnectAttempt: number; hasSession: boolean;
}
export interface ZaloMessage {
  platform: 'zalo'; accountId: string; messageId: string; threadId: string; threadType: 0 | 1;
  senderId: string; senderName: string; isSelf: boolean; agentId: string | null;
  text: string; timestamp: number; kind: 'text' | 'image' | 'file' | 'other';
  attachment: { url: string | null; name: string | null } | null;
  status: 'RECEIVED' | 'SENT' | 'DELIVERED' | 'SEEN';
}
export interface ZaloThread { accountId: string; threadId: string; threadType: 0 | 1; title: string; updatedAt: number; preview: string }
export interface ZaloFailure { id: string; accountId: string; threadId: string; text: string; status: string; attempts: number; error: string | null }
export interface ZaloLog { id: number; accountId: string; code: string; createdAt: string }
export interface ZaloSnapshot { accounts: ZaloAccount[]; logs: ZaloLog[]; failures: ZaloFailure[] }
export interface ZaloSendInput { accountId: string; threadId: string; threadType: 0 | 1; text: string; requestId: string }
export interface ZaloApi {
  snapshot(): Promise<import('./index').Result<ZaloSnapshot>>;
  add(label: string): Promise<import('./index').Result<ZaloAccount>>;
  action(accountId: string, action: 'qr' | 'cancel' | 'disconnect' | 'reconnect'): Promise<import('./index').Result<boolean>>;
  threads(accountId: string): Promise<import('./index').Result<ZaloThread[]>>;
  messages(accountId: string, threadId: string): Promise<import('./index').Result<ZaloMessage[]>>;
  send(input: ZaloSendInput): Promise<import('./index').Result<{ messageId: string }>>;
  onChanged(listener: () => void): () => void;
}