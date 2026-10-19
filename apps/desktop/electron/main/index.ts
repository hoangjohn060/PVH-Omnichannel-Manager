import { app, BrowserWindow, Menu, Tray, nativeImage, screen, dialog, session } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { DatabaseClient } from '../database/client';
import { registerIpc } from '../ipc/register';
import { productionCsp } from '../security/policy';
import type { Bootstrap, Settings, Route } from '@pvh/shared/types';
import { ZaloSupervisor } from '../zalo/supervisor';
import { FacebookAdapter } from '../facebook/adapter';
import { connectorLease } from '../auth/connector';
import { redactLog } from '../security/redaction';

app.setAppUserModelId('com.pvhmedia.omnichannel');
if (process.env.PVH_USER_DATA) app.setPath('userData', process.env.PVH_USER_DATA);
const locked = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let tray: Tray | null = null;
let database: DatabaseClient | null = null;
let zalo: ZaloSupervisor | null = null;
let quitting = false;
let settings: Settings;
let backupTimer: NodeJS.Timeout | undefined;
let changedTimer: NodeJS.Timeout | undefined;
const show = (): void => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } };
const quit = (): void => { quitting = true; app.quit(); };
function log(error: unknown): void {
  const safe = redactLog(error);
  console.error(safe);
  try {
    const file = join(app.getPath('userData'), 'desktop.log');
    if (existsSync(file) && statSync(file).size >= 2 * 1024 * 1024) {
      rmSync(`${file}.1`, { force: true }); renameSync(file, `${file}.1`);
    }
    appendFileSync(file, `${new Date().toISOString()} ${safe}\n`);
  } catch { /* unavailable disk; stderr above still reports the redacted error */ }
}
if (!locked) app.quit();
else {
  app.on('second-instance', show);
  app.on('activate', show);
  app.on('window-all-closed', () => { if (!tray) quit(); });
  void app.whenReady().then(start).catch(error => {
    log(error); splash?.destroy();
    dialog.showErrorBox('PVH — Không thể khởi động', `Không thể mở cơ sở dữ liệu hoặc giao diện.\n${String(error)}\nHãy kiểm tra native ABI và quyền ghi userData.`);
    quit();
  });
}
async function start(): Promise<void> {
  splash = new BrowserWindow({ width: 380, height: 190, frame: false, resizable: false, center: true, alwaysOnTop: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  await splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html lang="vi"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><body style="background:#101b31;color:#fff;font:16px Segoe UI;padding:30px"><h2>PVH Omnichannel</h2><p>Đang khởi động ứng dụng…</p></body></html>'));
  database = new DatabaseClient(app.getPath('userData'));
  await database.ready;
  const bootstrap = await database.call<Bootstrap>('bootstrap');
  settings = bootstrap.settings;
  const saved = await database.call<{ x?: number; y?: number; width: number; height: number; maximized?: boolean } | null>('window:get');
  const valid = saved && Number.isFinite(saved.width) && Number.isFinite(saved.height) && screen.getAllDisplays().some(({ workArea: area }) => typeof saved.x === 'number' && typeof saved.y === 'number' && saved.x + 100 > area.x && saved.x < area.x + area.width - 100 && saved.y >= area.y && saved.y < area.y + area.height - 50);
  const area = screen.getPrimaryDisplay().workAreaSize;
  const rendererUrl = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || pathToFileURL(join(__dirname, '../renderer/index.html')).href;
  window = new BrowserWindow({
    title: 'PVH Omnichannel Manager', show: false, icon: join(app.getAppPath(), 'assets/icon.png'),
    width: Math.min(valid && saved ? saved.width : 1366, area.width), height: Math.min(valid && saved ? saved.height : 768, area.height),
    ...(valid && saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 1000, minHeight: 620, backgroundColor: '#f4f6fa',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: !app.isPackaged },
  });
  const mainWindow = window;
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (app.isPackaged) session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [productionCsp] } }));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-redirect', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`Renderer terminated: ${details.reason}`);
    if (!quitting && dialog.showMessageBoxSync(mainWindow, { type: 'error', message: 'Giao diện đã dừng. Khôi phục giao diện?', buttons: ['Khôi phục', 'Thoát'] }) === 0) mainWindow.reload();
    else quit();
  });
  zalo = new ZaloSupervisor(database, app.getPath('userData'), () => {
    changedTimer ??= setTimeout(() => {
      changedTimer = undefined;
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('zalo:changed');
    }, 100);
  });
  await zalo.initialize();
  connectorLease().watch(id => zalo!.action(id,'disconnect'));
  registerIpc({ database, zalo, facebook: new FacebookAdapter(), window: mainWindow, rendererUrl, getSettings: () => settings, setSettings: next => { settings = next; }, quit });
  let boundsTimer: NodeJS.Timeout | undefined;
  const saveBounds = (): void => {
    if (!database || mainWindow.isDestroyed()) return;
    void database.call('window:set', { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }).catch(log);
  };
  mainWindow.on('resize', () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 250); });
  mainWindow.on('move', () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 250); });
  mainWindow.on('minimize', () => { if (settings.minimizeToTray) mainWindow.hide(); });
  mainWindow.on('close', event => {
    saveBounds();
    if (!quitting && settings.runInBackground) { event.preventDefault(); mainWindow.hide(); }
    else if (!quitting) { event.preventDefault(); quit(); }
  });
  mainWindow.on('closed', () => { clearTimeout(boundsTimer); window = null; });
  const navigate = (route: Route): void => { show(); mainWindow.webContents.send('desktop:navigate', route); };
  tray = new Tray(nativeImage.createFromPath(join(app.getAppPath(), 'assets/icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('PVH Omnichannel Manager');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Mở PVH Omnichannel', click: show }, { label: 'Cài đặt', click: () => navigate('settings') }, { type: 'separator' }, { label: 'Thoát', click: quit }]));
  tray.on('double-click', show);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Ứng dụng', submenu: [{ label: 'Tổng quan', accelerator: 'Ctrl+1', click: () => navigate('dashboard') }, { label: 'Hộp thư chung', accelerator: 'Ctrl+2', click: () => navigate('inbox') }, { label: 'Cài đặt', accelerator: 'Ctrl+,', click: () => navigate('settings') }, { type: 'separator' }, { label: 'Thoát', accelerator: 'Alt+F4', click: quit }] },
    { label: 'Chỉnh sửa', submenu: [{ role: 'undo', label: 'Hoàn tác' }, { role: 'redo', label: 'Làm lại' }, { type: 'separator' }, { role: 'cut', label: 'Cắt' }, { role: 'copy', label: 'Sao chép' }, { role: 'paste', label: 'Dán' }, { role: 'selectAll', label: 'Chọn tất cả' }] },
    { label: 'Hiển thị', submenu: [{ role: 'resetZoom', label: 'Thu phóng mặc định' }, { role: 'zoomIn', label: 'Phóng to' }, { role: 'zoomOut', label: 'Thu nhỏ' }] },
    { label: 'Trợ giúp', submenu: [{ label: 'Giới thiệu', click: () => { void dialog.showMessageBox(mainWindow, { message: 'PVH Omnichannel Manager', detail: `Phiên bản ${app.getVersion()} — Phase 01\nỨng dụng Windows · Dữ liệu cục bộ`, buttons: ['Đóng'] }); } }] },
  ]));
  if (saved?.maximized) mainWindow.maximize();
  await mainWindow.loadURL(rendererUrl);
  splash.destroy(); splash = null;
  if (!(process.argv.includes('--background') && settings.runInBackground)) show();
  void database.call('backup').catch(log);
  backupTimer = setInterval(() => { void database?.call('backup').catch(log); }, 24 * 60 * 60 * 1000);
}
let shutdownStarted = false;
app.on('before-quit', event => {
  quitting = true;
  if (shutdownStarted) return;
  event.preventDefault(); shutdownStarted = true;
  clearInterval(backupTimer);
  clearTimeout(changedTimer);
  const finish = async (): Promise<void> => {
    try {
      if (window && database) await database.call('window:set', { ...window.getNormalBounds(), maximized: window.isMaximized() });
      await zalo?.close();
      await database?.close();
    } catch (error) { log(error); }
    finally { tray?.destroy(); tray = null; app.quit(); }
  };
  void finish();
});