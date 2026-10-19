import { ipcMain, Notification, app } from 'electron';
import type { BrowserWindow } from 'electron';
import { ipcSchemas, parseIpc } from '@pvh/shared/schemas';
import type { Bootstrap, Settings } from '@pvh/shared/types';
import type { DatabaseClient } from '../database/client';
import { isTrustedRenderer } from '../security/policy';
import type { ZaloSupervisor } from '../zalo/supervisor';
import type { FacebookAdapter } from '../facebook/adapter';
import { InboxBridge } from '../inbox/bridge';
import { gatewaySession } from '../auth/session';
import { connectorLease } from '../auth/connector';

export function registerIpc(options: { database: DatabaseClient; zalo: ZaloSupervisor; facebook: FacebookAdapter; window: BrowserWindow; rendererUrl: string; getSettings: () => Settings; setSettings: (settings: Settings) => void; quit: () => void }): void {
  const { database, window } = options;
  const inbox = new InboxBridge(database, options.zalo);
  inbox.start();
  window.once('closed', () => inbox.close());
  for (const method of Object.keys(ipcSchemas)) {
    ipcMain.handle(method, async (event, input: unknown) => {
      try {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isTrustedRenderer(event.senderFrame.url, options.rendererUrl)) throw new Error('UNTRUSTED_SENDER');
        const payload = parseIpc(method, input);
        let data: unknown;
        switch (method) {
          case 'auth:status': data=gatewaySession().status();break;
          case 'auth:configure': data=gatewaySession().configure((payload as {origin:string}).origin);break;
          case 'auth:login': {const p=payload as {email:string;password:string};data=await gatewaySession().login(p.email,p.password);break;}
          case 'auth:logout': {connectorLease().suspend();try{for(const account of (await options.zalo.snapshot()).accounts)await options.zalo.action(account.id,'disconnect');}finally{data=await gatewaySession().logout();}break;}
          case 'auth:employees': data=await gatewaySession().request('auth/employees',payload);break;
          case 'auth:remove': data=await gatewaySession().request('auth/employees/remove',payload);break;
          case 'inbox:request': { const p = payload as {path:string;body?:unknown}; data = await inbox.request(p.path,p.body); break; }
          case 'facebook:snapshot': data = await options.facebook.snapshot(); break;
          case 'facebook:connect': data = await options.facebook.connect(); break;
          case 'facebook:transaction': data = await options.facebook.transaction((payload as { id: string }).id); break;
          case 'facebook:select': { const p = payload as { transactionId: string; pageId: string }; data = await options.facebook.select(p.transactionId, p.pageId); break; }
          case 'facebook:action': { const p = payload as { connectionId: string; action: 'check' | 'disconnect' }; data = await options.facebook.action(p.connectionId, p.action); break; }
          case 'facebook:threads': data = await options.facebook.threads((payload as { connectionId: string }).connectionId); break;
          case 'facebook:messages': { const p = payload as { connectionId: string; psid: string }; data = await options.facebook.messages(p.connectionId, p.psid); break; }
          case 'facebook:send': throw new Error('USE_AUTHORIZED_UNIFIED_INBOX');
          case 'app:bootstrap': data = { ...await database.call<Omit<Bootstrap, 'version' | 'platform' | 'channels'>>('bootstrap'), version: app.getVersion(), platform: process.platform, channels: [{ id: 'zalo', status: options.zalo.connectedCount() > 0 ? 'connected' : 'not_connected' }, { id: 'facebook', status: options.facebook.connectedCount() > 0 ? 'connected' : 'not_connected' }] }; break;
          case 'zalo:snapshot': data = { ...await options.zalo.snapshot(), failures: [] }; break;
          case 'zalo:add': data = await options.zalo.add((payload as { label: string }).label); break;
          case 'zalo:action': { const p = payload as { accountId: string; action: 'qr' | 'cancel' | 'disconnect' | 'reconnect' }; data = await options.zalo.action(p.accountId, p.action); break; }
          case 'zalo:threads': case 'zalo:messages': throw new Error('USE_AUTHORIZED_UNIFIED_INBOX');
          case 'zalo:send': throw new Error('USE_AUTHORIZED_UNIFIED_INBOX');
          case 'settings:update': {
            const previous = options.getSettings();
            const next = { ...previous, ...payload as Partial<Settings> };
            if (next.launchAtLogin !== previous.launchAtLogin) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--background'] });
            try { data = await database.call<Settings>('settings', payload); }
            catch (error) { app.setLoginItemSettings({ openAtLogin: previous.launchAtLogin, args: ['--background'] }); throw error; }
            options.setSettings(data as Settings); break;
          }
          case 'database:backup': data = await database.call('backup'); break;
          case 'app:notify': {
            const notification = payload as { title: string; body: string };
            data = options.getSettings().notifications && Notification.isSupported();
            if (data) new Notification(notification).show(); break;
          }
          case 'app:quit': data = true; setImmediate(options.quit); break;
        }
        return { ok: true, data };
      } catch (error) {
        // Never log raw connector errors or invalid payloads (may include secrets).
        console.error(`[IPC ${method}] OPERATION_FAILED`);
        return { ok: false, error: (method.startsWith('facebook:') || method.startsWith('inbox:')) && error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'Không thể thực hiện thao tác. Vui lòng thử lại hoặc kiểm tra nhật ký ứng dụng.' };
      }
    });
  }
}