export interface Env {
  DB: D1Database;
  META_APP_ID: string;
  META_APP_SECRET: string;
  META_VERIFY_TOKEN: string;
  TOKEN_ENCRYPTION_KEY: string;
  PUBLIC_ORIGIN: string;
}
export interface Principal { org_id: string; user_id: string; device_id?: string; session_id?: string; role: 'super_admin' | 'admin' | 'manager' | 'agent' | 'viewer' }
export interface PageRow {
  id: string; org_id: string; page_id: string; name: string; token: string | null;
  status: string; permissions: string; webhook: number; checked_at: number | null;
  owner_id: string; error: string | null;
}
export interface NormalizedEvent {
  pageId: string; psid: string; conversationId: string; timestamp: number;
  kind: 'message' | 'delivery' | 'read'; messageId: string | null; echo: boolean;
  text: string; attachments: unknown[]; mids: string[]; watermark: number | null;
}
