import type { Env, Principal } from './types';
export async function requireLease(env: Env,p: Principal,channelId: string,device: string | undefined,fence: string | undefined): Promise<void> {
  if(!device || !fence || (p.device_id && p.device_id!==device))throw new Error('CONNECTOR_LEASE_REQUIRED');
  const row=await env.DB.prepare(`SELECT 1 FROM connector_leases l JOIN channel_connections c ON c.id=l.channel_id AND c.organization_id=l.organization_id
    WHERE l.organization_id=? AND l.channel_id=? AND l.device_id=? AND l.fence=? AND l.user_id=? AND l.expires_at>? AND c.connector_user_id=l.user_id`)
    .bind(p.org_id,channelId,device,fence,p.user_id,Date.now()).first();
  if(!row)throw new Error('CONNECTOR_LEASE_LOST');
}