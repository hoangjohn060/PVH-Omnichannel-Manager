import { hex, hmac } from './security';
import type { Env } from './types';
export const GRAPH_VERSION = 'v26.0';
export const REQUIRED_PERMISSIONS = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'] as const;
export const WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'message_deliveries', 'message_reads'];
export class GraphError extends Error {
  constructor(public readonly code: number, public readonly subcode: number | null, public readonly trace: string | null, public readonly transient = false) {
    // Meta error.message can contain request data/tokens. Expose structured real codes only.
    super(`GRAPH_${code}${subcode ? `_${subcode}` : ''}`);
  }
}
export class Graph {
  constructor(private readonly env: Env, private readonly transport: typeof fetch = fetch) {}
  async call<T>(path: string, token: string, method = 'GET', input?: Record<string, unknown>): Promise<T> {
    if (!/^[a-zA-Z0-9_/-]+$/.test(path)) throw new Error('INVALID_GRAPH_PATH');
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
    if (token) url.searchParams.set('appsecret_proof', hex(await hmac(this.env.META_APP_SECRET, new TextEncoder().encode(token).buffer)));
    if (method === 'GET' && input) for (const [key, value] of Object.entries(input)) url.searchParams.set(key, String(value));
    const response = await this.transport(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(input ?? {}) }), signal: AbortSignal.timeout(12000), redirect: 'error' });
    const data = await response.json() as T & { error?: { code?: number; error_subcode?: number; fbtrace_id?: string; is_transient?: boolean } };
    if (data.error) throw new GraphError(data.error.code ?? response.status, data.error.error_subcode ?? null, data.error.fbtrace_id ?? null, data.error.is_transient === true || response.status >= 500);
    if (!response.ok) throw new GraphError(response.status, null, null);
    return data;
  }
  async exchange(code: string): Promise<string> {
    const response = await this.transport(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.env.META_APP_ID, client_secret: this.env.META_APP_SECRET, redirect_uri: `${this.env.PUBLIC_ORIGIN}/meta/callback`, code }).toString(), signal: AbortSignal.timeout(12000), redirect: 'error' });
    const data = await response.json() as { access_token?: string; error?: { code?: number; error_subcode?: number; fbtrace_id?: string } };
    if (!response.ok || data.error) throw new GraphError(data.error?.code ?? response.status, data.error?.error_subcode ?? null, data.error?.fbtrace_id ?? null);
    if (!data.access_token) throw new Error('TOKEN_EXCHANGE_FAILED');
    return data.access_token;
  }
  async pages(token: string): Promise<{ id: string; name: string; access_token: string; tasks: string[] }[]> {
    const result: { id: string; name: string; access_token: string; tasks: string[] }[] = [];
    let after: string | undefined;
    for (let i = 0; i < 100; i++) {
      const data = await this.call<{ data: typeof result; paging?: { next?: string; cursors?: { after?: string } } }>('me/accounts', token, 'GET', { fields: 'id,name,access_token,tasks', limit: 100, ...(after ? { after } : {}) });
      result.push(...data.data);
      if (!data.paging?.next) return result;
      after = data.paging.cursors?.after;
      if (!after) throw new Error('GRAPH_PAGINATION_INVALID');
    }
    throw new Error('TOO_MANY_PAGES');
  }
  async inspect(token: string, pageId?: string): Promise<string[]> {
    const data = await this.call<{ data: { is_valid: boolean; app_id: string; profile_id?: string; scopes?: string[]; granular_scopes?: { scope: string; target_ids?: string[] }[]; expires_at?: number; data_access_expires_at?: number } }>('debug_token', `${this.env.META_APP_ID}|${this.env.META_APP_SECRET}`, 'GET', { input_token: token });
    const info = data.data; const now = Date.now() / 1000;
    if (!info.is_valid || String(info.app_id) !== this.env.META_APP_ID || (info.expires_at && info.expires_at <= now) || (info.data_access_expires_at && info.data_access_expires_at <= now)) throw new GraphError(190, null, null);
    if (pageId && info.profile_id && info.profile_id !== pageId) throw new Error('TOKEN_PAGE_MISMATCH');
    return (info.scopes ?? []).filter(scope => {
      const restriction = info.granular_scopes?.find(item => item.scope === scope);
      return !pageId || !restriction?.target_ids || restriction.target_ids.includes(pageId);
    });
  }
}