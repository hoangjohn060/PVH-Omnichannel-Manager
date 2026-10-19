import type { AuthService, FacebookAdapter, GatewayClient, SheetSyncService, ZaloAdapter } from '@pvh/shared/adapters';
const unavailable = async (): Promise<never> => { throw new Error('Chưa kết nối. Tích hợp sẽ được triển khai ở phase tiếp theo.'); };
export const zaloAdapter: ZaloAdapter = { channel: 'zalo', status: async () => 'not_connected', connect: unavailable, disconnect: async () => {}, sendMessage: unavailable };
export const facebookAdapter: FacebookAdapter = { channel: 'facebook', status: async () => 'not_connected', connect: unavailable, disconnect: async () => {}, sendMessage: unavailable };
export const authService: AuthService = { currentUser: async () => null, signIn: unavailable, signOut: async () => {} };
export const sheetSyncService: SheetSyncService = { status: async () => 'not_connected', synchronize: unavailable };
export const gatewayClient: GatewayClient = { status: async () => 'not_connected', request: unavailable };