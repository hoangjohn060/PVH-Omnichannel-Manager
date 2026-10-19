import type { Result } from './index';
export interface FacebookPage { id: string; pageId: string; name: string; status: string; permissions: string[]; webhook: boolean; checkedAt: number | null; error: string | null }
export interface FacebookTransaction { id: string; status: string; error: string | null; pages: { pageId: string; name: string; tasks: string }[] }
export interface FacebookThread { psid: string; conversationId: string; lastInbound: number }
export interface FacebookMessage { messageId: string; direction: string; text: string; attachments: string; timestamp: number; agentId: string | null; status: string }
export interface FacebookLog { id: number; connectionId: string | null; code: string; subcode: number | null; trace: string | null; createdAt: number }
export interface FacebookSend { connectionId: string; psid: string; requestId: string; text?: string; attachment?: { type: 'image' | 'file'; url: string } }
export interface FacebookApi {
  snapshot(): Promise<Result<{ configured: boolean; pages: FacebookPage[]; logs: FacebookLog[]; blocked: string | null }>>;
  connect(): Promise<Result<{ id: string; expiresAt: number }>>;
  transaction(id: string): Promise<Result<FacebookTransaction>>;
  select(transactionId: string, pageId: string): Promise<Result<FacebookPage>>;
  action(connectionId: string, action: 'check' | 'disconnect'): Promise<Result<unknown>>;
  threads(connectionId: string): Promise<Result<{ threads: FacebookThread[] }>>;
  messages(connectionId: string, psid: string): Promise<Result<{ messages: FacebookMessage[] }>>;
  send(input: FacebookSend): Promise<Result<{ status: string; messageId: string | null; error?: string }>>;
}