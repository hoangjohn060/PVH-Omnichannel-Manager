import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// Login QR is sensitive. Do not retain traces/screenshots containing it even on failure.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const envFor = () => { const env: Record<string, string> = {}; for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value; env.PVH_USER_DATA = mkdtempSync(join(tmpdir(), 'pvh-zalo-e2e-')); return env; };
async function launch() {
  const application = await electron.launch({ ...(process.env.PVH_PACKAGED ? { executablePath: resolve('dist/win-unpacked/PVH Omnichannel Manager.exe') } : { args: [resolve('apps/desktop')] }), env: envFor(), timeout: 45000 });
  let page = application.windows().find(candidate => candidate.url().startsWith('file:'));
  if (!page) page = await application.waitForEvent('window', { predicate: candidate => !candidate.url().startsWith('data:') });
  await expect(page.getByTestId('workspace')).toBeVisible();
  return { application, page };
}
test('Windows safeStorage real encryption roundtrip, Zalo empty state and secure bridge', async () => {
  const { application, page } = await launch();
  try {
    const encryption = await application.evaluate(({ safeStorage }) => {
      if (!safeStorage.isEncryptionAvailable()) return { available: false, roundtrip: false, ciphertext: false };
      const testSecret = JSON.stringify({ cookie: 'TEST_ONLY_NOT_A_ZALO_CREDENTIAL', unicode: 'Tiếng Việt' });
      const bytes = safeStorage.encryptString(testSecret);
      return { available: true, roundtrip: safeStorage.decryptString(bytes) === testSecret, ciphertext: !bytes.includes(Buffer.from('TEST_ONLY_NOT_A_ZALO_CREDENTIAL')) };
    });
    expect(encryption).toEqual({ available: true, roundtrip: true, ciphertext: true });
    await page.getByRole('navigation').getByRole('button', { name: 'Zalo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Zalo', exact: true })).toBeVisible();
    await expect(page.getByText('Chưa có tài khoản.', { exact: false })).toBeVisible();
    const snapshot = await page.evaluate(() => window.desktop.zalo.snapshot());
    expect(snapshot).toEqual({ ok: true, data: { accounts: [], logs: [], failures: [] } });
    expect(await page.evaluate(() => Object.keys(window.desktop.zalo).sort())).toEqual(['action', 'add', 'messages', 'onChanged', 'send', 'snapshot', 'threads']);
    expect((await page.evaluate(() => window.desktop.zalo.action('invalid', 'reconnect'))).ok).toBe(false);
  } finally { await application.close(); }
});
test('LIVE SDK QR generation and actual QR rendering — no scan or login claim', async () => {
  test.skip(process.env.PVH_LIVE_QR !== '1', 'Opt-in network test. No owned-account scan available.');
  test.setTimeout(110000);
  const { application, page } = await launch();
  try {
    await page.getByRole('navigation').getByRole('button', { name: 'Zalo', exact: true }).click();
    await page.getByLabel('Tên tài khoản Zalo').fill('Kiểm thử QR thật — chưa đăng nhập');
    await page.getByRole('button', { name: 'Thêm Zalo', exact: true }).click();
    await expect(page.getByTestId('zalo-qr')).toBeVisible({ timeout: 70000 });
    const image = page.getByTestId('zalo-qr');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 100)).toBe(true);
    const snapshot = await page.evaluate(() => window.desktop.zalo.snapshot());
    expect(snapshot.ok && snapshot.data.accounts[0]).toMatchObject({ state: 'WAITING_SCAN', hasSession: false, expiresAt: null });
    await expect(page.getByText('SDK không cung cấp thời hạn QR', { exact: false })).toBeVisible();
    // Deliberately no screenshot/QR logging: a login QR is sensitive ephemeral material.
    await page.getByRole('button', { name: 'Hủy đăng nhập' }).click();
    await expect(page.getByTestId('zalo-qr')).toHaveCount(0);
    await expect.poll(async () => { const next = await page.evaluate(() => window.desktop.zalo.snapshot()); return next.ok ? next.data.accounts[0]?.state : ''; }).toBe('DISCONNECTED');
    console.log('SDK_TESTED=QR_FLOW; QR_DISPLAYED=PASS; REAL_LOGIN_VERIFIED=BLOCKED; INBOUND_VERIFIED=BLOCKED; OUTBOUND_VERIFIED=BLOCKED');
  } finally { await application.close(); }
});