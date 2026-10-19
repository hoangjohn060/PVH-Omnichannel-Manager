import type { Result } from './index';
export type InboxRole = 'super_admin' | 'admin' | 'manager' | 'agent' | 'viewer';
export interface InboxChannel { id: string; organization_id: string; platform: 'zalo' | 'facebook'; name: string; external_id: string; connector_user_id: string | null }
export interface InboxMember { user_id: string; name: string; role: InboxRole; active: number }
export interface InboxConversation {
 id: string; channel_id: string; customer_id: string; external_id: string; name: string; avatar: string | null;
 platform: 'zalo' | 'facebook'; channel_name: string; preview: string; updated_at: number; created_at: number;
 status: 'OPEN' | 'PENDING' | 'RESOLVED'; assigned_user_id: string | null; agent_name: string | null; version: number; unread: number;
}
export interface InboxMessage {
 id: string; organization_id: string; platform: 'zalo' | 'facebook'; channel_id: string; conversation_id: string;
 external_message_id: string | null; direction: 'incoming' | 'outgoing'; content: string;
 sender_id: string | null; sender_name: string; sender_type: string; agent_id: string | null; agent_name: string | null;
 sender_origin: 'desktop_agent' | 'zalo_native' | 'facebook_native' | 'external' | 'system'; attribution_status: 'verified' | 'unknown';
 source_created_at: number; received_at: number; send_status: string; created_at: number; attachments: string;
}
export interface InboxDetail {
 conversation: InboxConversation; customer: { id: string; name: string; tags: string; care_notes: string; created_at: number; updated_at: number; version: number };
 messages: InboxMessage[]; next: string | null; draft: string;
 notes: { id: string; actor_id: string; content: string; created_at: number }[];
 history: { id: string; status: string; created_at: number }[];
 stats: { incoming: number; outgoing: number; first_response_ms: number | null };
}
export interface InboxSession { principal: { org_id: string; user_id: string; role: InboxRole }; channels: InboxChannel[]; members: InboxMember[] }
export interface InboxRequest { path: string; body?: unknown }
export interface InboxApi { request<T>(input: InboxRequest): Promise<Result<T>> }