import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('first run configures HTTPS Gateway through UI and persists after restart without environment setup', async () => {
  const directory=mkdtempSync(join(tmpdir(),'pvh-onboarding-'));
  const env:Record<string,string>=Object.fromEntries(Object.entries({...process.env,PVH_USER_DATA:directory}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PVH_GATEWAY_URL;
  const launch=()=>electron.launch({...(process.env.PVH_PACKAGED?{executablePath:resolve('dist/win-unpacked/PVH Omnichannel Manager.exe')}:{args:[resolve('apps/desktop')]}),env,timeout:45000});
  let application=await launch();
  try {
    let page=application.windows().find(candidate=>candidate.url().startsWith('file:'))??await application.waitForEvent('window',{predicate:candidate=>!candidate.url().startsWith('data:')});
    await expect(page.getByLabel('Gateway URL',{exact:true})).toBeVisible();
    expect((await page.evaluate(()=>window.desktop.auth.configure('http://localhost'))).ok).toBe(false);
    await page.getByLabel('Gateway URL',{exact:true}).fill('https://gateway.example.com');
    await page.getByRole('button',{name:'Lưu Gateway',exact:true}).click();
    await expect(page.getByRole('button',{name:'Đăng nhập',exact:true})).toBeEnabled();
    await application.close();
    application=await launch();
    page=application.windows().find(candidate=>candidate.url().startsWith('file:'))??await application.waitForEvent('window',{predicate:candidate=>!candidate.url().startsWith('data:')});
    await expect(page.getByRole('button',{name:'Đăng nhập',exact:true})).toBeEnabled();
    const status=await page.evaluate(()=>window.desktop.auth.status());
    expect(status.ok&&status.data).toMatchObject({origin:'https://gateway.example.com',authenticated:false});
  } finally { await application.close();rmSync(directory,{recursive:true,force:true}); }
});