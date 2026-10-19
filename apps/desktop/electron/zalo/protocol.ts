import type { Credentials } from 'zca-js';
import type { ZaloMessage, ZaloSendInput } from '@pvh/shared/types';
import type { ZaloEvent } from './state';
export type WorkerCommand = { type:'identity-saved' } | { type: 'qr' } | { type: 'restore'; credentials: Credentials } | { type: 'stop' } | { type: 'persist' } | { type: 'send'; input: ZaloSendInput } | { type: 'session-saved' };
export type WorkerEvent =
  | { type: 'state'; event: ZaloEvent }
  | { type: 'qr'; image: string }
  | { type: 'profile'; displayName: string; avatar: string }
  | { type: 'session'; credentials: Credentials }
  | { type: 'identity'; uid: string }
  | { type: 'message'; message: ZaloMessage }
  | { type: 'messages'; messages: ZaloMessage[] }
  | { type: 'delivery'; messageIds: string[]; status: 'DELIVERED' | 'SEEN' }
  | { type: 'sent'; requestId: string; messageId: string }
  | { type: 'send-failed'; requestId: string; code: string }
  | { type: 'failure'; code: string; retryable: boolean; expired: boolean }
  | { type: 'stopped' };