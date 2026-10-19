import type { Channel, ConnectionStatus, Customer, Message } from '../types';
export interface ChannelAdapter {
  readonly channel: Channel;
  status(): Promise<ConnectionStatus>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(conversationId: string, text: string): Promise<Message>;
}
export interface ZaloAdapter extends ChannelAdapter { readonly channel: 'zalo' }
export interface FacebookAdapter extends ChannelAdapter { readonly channel: 'facebook' }
export interface MessageRepository { list(conversationId: string, limit: number): Promise<Message[]>; save(messages: Message[]): Promise<void> }
export interface CustomerRepository { search(query: string, limit: number): Promise<Customer[]>; save(customers: Customer[]): Promise<void> }
export interface AuthService { currentUser(): Promise<{ id: string; name: string } | null>; signIn(): Promise<void>; signOut(): Promise<void> }
export interface SheetSyncService { status(): Promise<ConnectionStatus>; synchronize(): Promise<{ processed: number }> }
export interface GatewayClient { status(): Promise<ConnectionStatus>; request<T>(path: string, payload?: unknown): Promise<T> }