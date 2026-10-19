import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('Facebook secure bridge, Settings UI and truthful blocked state without Meta credentials', async () => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !['ELECTRON_RUN_AS_NODE', 'PVH_GATEWAY_URL', 'PVH_GATEWAY_CREDENTIAL'].includes(key)) env[key] = value;
  env.PVH_USER_DATA = mkdtempSync(join(tmpdir(), 'pvh-facebook-e2e-'));
  const application = await electron.launch({ ...(process.env.PVH_PACKAGED ? { executablePath: resolve('dist/win-unpacked/PVH Omnichannel Manager.exe') } : { args: [resolve('apps/desktop')] }), env, timeout: 45000 });
  try {
    const page = application.windows().find(candidate => candidate.url().startsWith('file:')) ?? await application.waitForEvent('window', { predicate: candidate => !candidate.url().startsWith('data:') });
    await expect(page.getByTestId('workspace')).toBeVisible();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('navigation').getByRole('button', { name: 'Facebook Fanpage', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Facebook Fanpage', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('BLOCKED');
    await expect(page.getByRole('button', { name: 'Kết nối Facebook', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => Object.keys(window.desktop.facebook).sort())).toEqual(['action', 'connect', 'messages', 'select', 'send', 'snapshot', 'threads', 'transaction']);
    expect(await page.evaluate(() => window.desktop.facebook.snapshot())).toMatchObject({ ok: true, data: { configured: false, pages: [], logs: [] } });
    expect((await page.evaluate(() => window.desktop.facebook.send({ connectionId: 'invalid', psid: '1', requestId: 'bad', text: 'test' }))).ok).toBe(false);
    await page.getByRole('navigation').getByRole('button', { name: 'Cài đặt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Facebook Fanpage', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await application.close(); }
});