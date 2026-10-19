import { z } from 'zod';

export const routes = ['dashboard', 'inbox', 'zalo', 'facebook', 'customers', 'employees', 'google-sheets', 'reports', 'activity', 'settings'] as const;
const settingsFields = {
  theme: z.enum(['light', 'dark', 'system']),
  route: z.enum(routes),
  minimizeToTray: z.boolean(),
  runInBackground: z.boolean(),
  launchAtLogin: z.boolean(),
  notifications: z.boolean(),
};
export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  route: z.enum(routes).default('dashboard'),
  minimizeToTray: z.boolean().default(false),
  runInBackground: z.boolean().default(false),
  launchAtLogin: z.boolean().default(false),
  notifications: z.boolean().default(true),
}).strict();
// Do not derive patches from fields with defaults: omitted keys must stay omitted.
export const settingsPatchSchema = z.object(settingsFields).partial().strict();
export const emptySchema = z.object({}).strict();
const accountId = z.uuid();
const threadId = z.string().regex(/^\d{1,30}$/);
export const zaloSendSchema = z.object({ accountId, threadId, threadType: z.union([z.literal(0), z.literal(1)]), text: z.string().trim().min(1).max(5000), requestId: z.uuid() }).strict();
export const ipcSchemas = {
  'auth:status': emptySchema,
  'auth:configure': z.object({origin:z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password;}catch{return false;}})}).strict(),
  'auth:login': z.object({email:z.email().max(254),password:z.string().min(1).max(128)}).strict(),
  'auth:logout': emptySchema,
  'auth:employees': z.object({userId:z.string().min(1).max(80),name:z.string().min(1).max(100),email:z.email().max(254),password:z.string().min(15).max(128),role:z.enum(['super_admin','admin','manager','agent','viewer'])}).strict(),
  'auth:remove': z.object({userId:z.string().min(1).max(80)}).strict(),
  'inbox:request': z.object({
    path: z.string().max(4096).refine(value => {
      try {
        const [path, query, extra] = value.split('?');
        if (!path || extra !== undefined || value.includes('#') || /[\\\r\n]/.test(value)) return false;
        const decoded = decodeURIComponent(path);
        if (!/^(sheets(?:\/(configure|check|enabled|sync|retry))?|session|members|grants|audit|changes|conversations|conversations\/[A-Za-z0-9:_-]+(?:\/(update|draft|read|notes|customer|send|jobs))?|jobs\/[a-fA-F0-9-]{36}\/retry)$/.test(decoded)) return false;
        return [...new URLSearchParams(query).keys()].every(key => ['q','platform','channel','before','after'].includes(key));
      } catch { return false; }
    }),
    body: z.unknown().optional(),
  }).strict(),
  'facebook:snapshot': emptySchema,
  'facebook:connect': emptySchema,
  'facebook:transaction': z.object({ id: z.uuid() }).strict(),
  'facebook:select': z.object({ transactionId: z.uuid(), pageId: threadId }).strict(),
  'facebook:action': z.object({ connectionId: z.uuid(), action: z.enum(['check', 'disconnect']) }).strict(),
  'facebook:threads': z.object({ connectionId: z.uuid() }).strict(),
  'facebook:messages': z.object({ connectionId: z.uuid(), psid: threadId }).strict(),
  'facebook:send': z.object({ connectionId: z.uuid(), psid: threadId, requestId: z.uuid(), text: z.string().trim().min(1).max(2000).optional(), attachment: z.object({ type: z.enum(['image', 'file']), url: z.url().max(2048).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }) }).strict().optional() }).strict().refine(value => Boolean(value.text) !== Boolean(value.attachment)),
  'app:bootstrap': emptySchema,
  'settings:update': settingsPatchSchema,
  'database:backup': emptySchema,
  'app:notify': z.object({ title: z.string().trim().min(1).max(100), body: z.string().trim().min(1).max(300) }).strict(),
  'app:quit': emptySchema,
  'zalo:snapshot': emptySchema,
  'zalo:add': z.object({ label: z.string().trim().min(1).max(80) }).strict(),
  'zalo:action': z.object({ accountId, action: z.enum(['qr', 'cancel', 'disconnect', 'reconnect']) }).strict(),
  'zalo:threads': z.object({ accountId }).strict(),
  'zalo:messages': z.object({ accountId, threadId }).strict(),
  'zalo:send': zaloSendSchema,
} as const;
export type IpcMethod = keyof typeof ipcSchemas;
export function parseIpc(method: string, input: unknown): unknown {
  if (!Object.hasOwn(ipcSchemas, method)) throw new Error('IPC_METHOD_NOT_ALLOWED');
  return ipcSchemas[method as IpcMethod].parse(input);
}