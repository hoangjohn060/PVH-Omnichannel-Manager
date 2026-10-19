const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('@playwright/test');
const env = { ...process.env, PVH_USER_DATA: mkdtempSync(join(tmpdir(), 'pvh-dev-')) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm dev --remoteDebuggingPort 9333'], { env, stdio: 'pipe' });
child.stdout.on('data', data => process.stdout.write(data));
child.stderr.on('data', data => process.stderr.write(data));
(async () => {
  let browser;
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9333'); break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    if (!browser) throw new Error('pnpm dev did not expose an Electron renderer');
    let page;
    for (let attempt = 0; attempt < 40; attempt++) {
      page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('http://127.0.0.1'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!page) throw new Error('Dev renderer unavailable');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.getByTestId('workspace').waitFor({ timeout: 20000 });
    if (await page.evaluate(() => typeof window.require !== 'undefined')) throw new Error('Node exposed');
    await page.getByRole('navigation').getByRole('button', { name: 'Cài đặt', exact: true }).click();
    await page.getByRole('heading', { name: 'Cài đặt', exact: true }).waitFor();
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('PASS: pnpm dev opens sandboxed Electron, React renders, navigation works, no console errors');
    await page.evaluate(() => window.desktop.quit());
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    if (browser) await browser.close();
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
})();