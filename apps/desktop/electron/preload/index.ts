import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, Route } from '@pvh/shared/types';

const api: DesktopApi = {
  auth: {
    configure:origin=>ipcRenderer.invoke('auth:configure',{origin}),
    status:()=>ipcRenderer.invoke('auth:status',{}),
    login:input=>ipcRenderer.invoke('auth:login',input),
    logout:()=>ipcRenderer.invoke('auth:logout',{}),
    employee:input=>ipcRenderer.invoke('auth:employees',input),
    remove:userId=>ipcRenderer.invoke('auth:remove',{userId}),
  },
  inbox: { request: input => ipcRenderer.invoke('inbox:request', input) },
  facebook: {
    snapshot: () => ipcRenderer.invoke('facebook:snapshot', {}),
    connect: () => ipcRenderer.invoke('facebook:connect', {}),
    transaction: id => ipcRenderer.invoke('facebook:transaction', { id }),
    select: (transactionId, pageId) => ipcRenderer.invoke('facebook:select', { transactionId, pageId }),
    action: (connectionId, action) => ipcRenderer.invoke('facebook:action', { connectionId, action }),
    threads: connectionId => ipcRenderer.invoke('facebook:threads', { connectionId }),
    messages: (connectionId, psid) => ipcRenderer.invoke('facebook:messages', { connectionId, psid }),
    send: input => ipcRenderer.invoke('facebook:send', input),
  },
  zalo: {
    snapshot: () => ipcRenderer.invoke('zalo:snapshot', {}),
    add: label => ipcRenderer.invoke('zalo:add', { label }),
    action: (accountId, action) => ipcRenderer.invoke('zalo:action', { accountId, action }),
    threads: accountId => ipcRenderer.invoke('zalo:threads', { accountId }),
    messages: (accountId, threadId) => ipcRenderer.invoke('zalo:messages', { accountId, threadId }),
    send: input => ipcRenderer.invoke('zalo:send', input),
    onChanged: listener => { const handler = (): void => listener(); ipcRenderer.on('zalo:changed', handler); return () => { ipcRenderer.removeListener('zalo:changed', handler); }; },
  },
  bootstrap: () => ipcRenderer.invoke('app:bootstrap', {}),
  updateSettings: patch => ipcRenderer.invoke('settings:update', patch),
  backup: () => ipcRenderer.invoke('database:backup', {}),
  notify: input => ipcRenderer.invoke('app:notify', input),
  quit: () => ipcRenderer.invoke('app:quit', {}),
  onNavigate: listener => {
    const handler = (_event: Electron.IpcRendererEvent, route: Route): void => listener(route);
    ipcRenderer.on('desktop:navigate', handler);
    return () => { ipcRenderer.removeListener('desktop:navigate', handler); };
  },
};
contextBridge.exposeInMainWorld('desktop', Object.freeze(api));