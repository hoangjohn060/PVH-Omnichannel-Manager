import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { DesktopApi } from '../../packages/shared/types';
declare global { interface Window { desktop: DesktopApi } }

const directory = mkdtempSync(join(tmpdir(), 'pvh-phase01-'));
let application: ElectronApplication;
async function launch(): Promise<Page> {
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, PVH_USER_DATA: directory, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ ...(process.env.PVH_PACKAGED ? { executablePath: resolve('dist/win-unpacked/PVH Omnichannel Manager.exe') } : { args: [resolve('apps/desktop')] }), env, timeout: 45_000 });
  const page = await application.waitForEvent('window', { predicate: candidate => candidate.url().startsWith('file:') }).catch(async () => {
    const windows = application.windows(); const found = windows.find(candidate => candidate.url().startsWith('file:')); if (!found) throw new Error('Main window unavailable'); return found;
  });
  await expect(page.getByTestId('workspace')).toBeVisible();
  return page;
}
test.afterEach(async () => { if (application) await application.close(); });
test('desktop security, navigation, backup and persistence across restart', async () => {
  let page = await launch();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  expect(await page.evaluate(() => ({ require: typeof (window as unknown as { require?: unknown }).require, process: typeof (window as unknown as { process?: unknown }).process, keys: Object.keys(window.desktop).sort() }))).toEqual({ require: 'undefined', process: 'undefined', keys: ['auth', 'backup', 'bootstrap', 'facebook', 'inbox', 'notify', 'onNavigate', 'quit', 'updateSettings', 'zalo'] });
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).length)).toBe(1);
  expect(await application.evaluate(({ BrowserWindow }) => { const prefs = (BrowserWindow.getAllWindows()[0]!.webContents as unknown as { getLastWebPreferences(): { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean } }).getLastWebPreferences(); return { sandbox: prefs.sandbox, isolation: prefs.contextIsolation, node: prefs.nodeIntegration }; })).toEqual({ sandbox: true, isolation: true, node: false });
  const unknownRejected = await application.evaluate(({ ipcMain }) => !(ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })._invokeHandlers.has('fs:read'));
  expect(unknownRejected).toBe(true);
  expect((await page.evaluate(() => window.desktop.updateSettings({ theme: 'invalid' } as never))).ok).toBe(false);
  const initial = await page.evaluate(() => window.desktop.bootstrap());
  expect(initial.ok && initial.data.database).toMatchObject({ journalMode: 'wal', foreignKeys: true, migrationVersion: 3, integrity: 'ok' });
  expect(initial.ok && initial.data.counts).toEqual({ customers: 0, conversations: 0, messages: 0, pending: 0 });
  // A second launch must exit rather than create another management process/window.
  const executable = process.env.PVH_PACKAGED ? resolve('dist/win-unpacked/PVH Omnichannel Manager.exe') : resolve('node_modules/electron/dist/electron.exe');
  const secondEnv: NodeJS.ProcessEnv = { ...process.env, PVH_USER_DATA: directory };
  delete secondEnv.ELECTRON_RUN_AS_NODE;
  const second = spawn(executable, process.env.PVH_PACKAGED ? [] : [resolve('apps/desktop')], { env: secondEnv, stdio: 'pipe' });
  await new Promise<void>((resolveExit, reject) => { const timer = setTimeout(() => { second.kill(); reject(new Error('Second instance did not exit')); }, 10_000); second.on('exit', code => { clearTimeout(timer); if (code === 0) resolveExit(); else reject(new Error(`Second instance exit ${code}`)); }); second.on('error', reject); });
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await page.evaluate(async () => { await window.desktop.updateSettings({ minimizeToTray: true, runInBackground: true }); });
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.minimize(); });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false);
  await application.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.restore(); w.show(); w.close(); });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false);
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.show(); });
  await page.evaluate(async () => { await window.desktop.updateSettings({ minimizeToTray: false, runInBackground: false }); });
  for (const label of ['Hộp thư chung', 'Zalo', 'Facebook Fanpage', 'Khách hàng', 'Nhân viên', 'Google Sheets', 'Báo cáo', 'Lịch sử hoạt động', 'Cài đặt', 'Tổng quan']) { await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click(); await expect(page.getByRole('heading', { name: label === 'Hộp thư chung' ? 'Hộp thư hợp nhất' : label === 'Nhân viên' ? 'Nhân viên và quyền inbox' : label, exact: true })).toBeVisible(); }
  await application.evaluate(({ Menu }) => { Menu.getApplicationMenu()!.items[0]!.submenu!.items.find(item => item.label === 'Cài đặt')!.click(); });
  await expect(page.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible();
  await page.getByLabel('Chủ đề', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveClass('dark');
  await page.getByRole('button', { name: 'Sao lưu ngay' }).click();
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByText('Đã sao lưu:', { exact: false })).toBeVisible();
  expect(existsSync(join(directory, 'pvh.sqlite'))).toBe(true);
  expect(readdirSync(join(directory, 'backups')).some(f => f.endsWith('.sqlite'))).toBe(true);
  await application.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.setBounds({ x: 30, y: 30, width: 1200, height: 700 }); });
  await page.screenshot({ path: `test-results/${process.env.PVH_PACKAGED ? 'packaged' : 'desktop'}-settings.png` });
  expect(errors).toEqual([]);
  await application.close();
  page = await launch();
  await expect(page.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible();
  await expect(page.getByLabel('Chủ đề', { exact: true })).toHaveValue('dark');
  const restarted = await page.evaluate(() => window.desktop.bootstrap());
  expect(restarted.ok && restarted.data.events.filter(e => e.action === 'app.started').length).toBe(2);
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds().width)).toBe(1200);
  // Deny external navigation and window creation from customer-controlled content.
  await page.evaluate(() => { window.open('https://example.com'); });
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  const url = page.url();
  await page.evaluate(() => { const link = document.createElement('a'); link.href = 'https://example.com'; link.textContent = 'test'; document.body.appendChild(link); link.click(); link.remove(); });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getURL())).toBe(url);
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript("Boolean(document.querySelector('[data-testid=workspace]'))"))).toBe(true);
});