import type { z } from 'zod';
import type { settingsSchema, routes } from '../schemas';
export type Settings = z.infer<typeof settingsSchema>;
export type Route = typeof routes[number];
export type Channel = 'zalo' | 'facebook';
export type ConnectionStatus = 'not_connected' | 'connecting' | 'connected' | 'error';
export interface Customer { id: string; displayName: string; updatedAt: string }
export interface Message { id: string; conversationId: string; body: string; createdAt: string }
export interface AuditEvent { id: number; action: string; createdAt: string }
export interface DatabaseHealth { journalMode: string; foreignKeys: boolean; migrationVersion: number; integrity: string; nativeAbi: string }
export interface Bootstrap {
  settings: Settings; version: string; platform: string; database: DatabaseHealth;
  counts: { customers: number; conversations: number; messages: number; pending: number };
  events: AuditEvent[];
  channels: { id: Channel; status: ConnectionStatus }[];
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export interface DesktopApi {
  auth: {
    configure(origin:string):Promise<Result<AuthStatus>>;
    status():Promise<Result<AuthStatus>>;
    login(input:{email:string;password:string}):Promise<Result<AuthStatus>>;
    logout():Promise<Result<AuthStatus>>;
    employee(input:{userId:string;name:string;email:string;password:string;role:import('./inbox').InboxRole}):Promise<Result<{saved:boolean}>>;
    remove(userId:string):Promise<Result<{saved:boolean}>>;
  };
  inbox: import('./inbox').InboxApi;
  facebook: import('./facebook').FacebookApi;
  zalo: import('./zalo').ZaloApi;
  bootstrap(): Promise<Result<Bootstrap>>;
  updateSettings(patch: Partial<Settings>): Promise<Result<Settings>>;
  backup(): Promise<Result<{ filename: string }>>;
  notify(input: { title: string; body: string }): Promise<Result<boolean>>;
  quit(): Promise<Result<boolean>>;
  onNavigate(listener: (route: Route) => void): () => void;
}
export interface AuthStatus { configured:boolean; origin?:string|null; authenticated:boolean; principal:{org_id:string;user_id:string;role:string}|null }
export type { ZaloAccount, ZaloState, ZaloMessage, ZaloThread, ZaloFailure, ZaloLog, ZaloSnapshot, ZaloSendInput } from './zalo';