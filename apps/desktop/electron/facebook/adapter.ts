import { shell } from 'electron';
import { gatewaySession } from '../auth/session';
import type { FacebookPage, FacebookLog, FacebookSend, FacebookTransaction, FacebookThread, FacebookMessage } from '@pvh/shared/types/facebook';
export function gatewayOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password ? value : null; } catch { return null; }
}
export function validMetaAuthorization(value: string): boolean {
  try { const url = new URL(value); return url.origin === 'https://www.facebook.com' && /^\/v\d+\.0\/dialog\/oauth$/.test(url.pathname) && !url.username && !url.password; } catch { return false; }
}
export class FacebookAdapter {
  private get origin(): string | null { return gatewaySession().origin; }
  private connected = 0;
  private checkedAt = 0;
  connectedCount(): number { return this.checkedAt > Date.now() - 300000 ? this.connected : 0; }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    return gatewaySession().request<T>(`facebook/${path}`,body);
  }
  async snapshot(): Promise<{ configured: boolean; pages: FacebookPage[]; logs: FacebookLog[]; blocked: string | null }> {
    this.connected = 0;
    if (!this.origin || !gatewaySession().status().authenticated) return { configured: false, pages: [], logs: [], blocked: 'BLOCKED: Cần cấu hình HTTPS gateway và đăng nhập nhân viên.' };
    const [pages, logs] = await Promise.all([this.request<{ pages: FacebookPage[] }>('pages'), this.request<{ logs: FacebookLog[] }>('logs')]);
    this.connected = pages.pages.filter(page => page.status === 'CONNECTED').length;
    this.checkedAt = Date.now();
    return { configured: true, pages: pages.pages, logs: logs.logs, blocked: null };
  }
  async connect(): Promise<{ id: string; expiresAt: number }> {
    const transaction = await this.request<{ id: string; expiresAt: number; authorizationUrl: string }>('oauth/start', {});
    if (!validMetaAuthorization(transaction.authorizationUrl)) throw new Error('UNTRUSTED_OAUTH_URL');
    await shell.openExternal(transaction.authorizationUrl);
    return { id: transaction.id, expiresAt: transaction.expiresAt };
  }
  transaction(id: string): Promise<FacebookTransaction> { return this.request(`oauth/${encodeURIComponent(id)}`); }
  select(transactionId: string, pageId: string): Promise<FacebookPage> { return this.request(`oauth/${encodeURIComponent(transactionId)}/select`, { pageId }); }
  action(connectionId: string, action: 'check' | 'disconnect'): Promise<unknown> { this.connected = 0; return this.request(`pages/${encodeURIComponent(connectionId)}/${action}`, {}); }
  threads(connectionId: string): Promise<{ threads: FacebookThread[] }> { return this.request(`pages/${encodeURIComponent(connectionId)}/threads`); }
  messages(connectionId: string, psid: string): Promise<{ messages: FacebookMessage[] }> { return this.request(`pages/${encodeURIComponent(connectionId)}/messages/${encodeURIComponent(psid)}`); }
  send(input: FacebookSend): Promise<{ status: string; messageId: string | null; error?: string }> { const { connectionId, ...body } = input; return this.request(`pages/${encodeURIComponent(connectionId)}/send`, body); }
}