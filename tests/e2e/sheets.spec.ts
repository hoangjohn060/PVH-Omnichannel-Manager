import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
test.use({trace:'off',screenshot:'off',video:'off'});
test('Google Sheets Settings shows honest backend setup requirement and fixed secure IPC',async()=>{
  const env:Record<string,string>={};for(const [key,value] of Object.entries(process.env))if(value!==undefined&&!['ELECTRON_RUN_AS_NODE','PVH_GATEWAY_URL','PVH_GATEWAY_CREDENTIAL'].includes(key))env[key]=value;
  env.PVH_USER_DATA=mkdtempSync(join(tmpdir(),'pvh-sheets-e2e-'));
  const application=await electron.launch({...process.env.PVH_PACKAGED?{executablePath:resolve('dist/win-unpacked/PVH Omnichannel Manager.exe')}:{args:[resolve('apps/desktop')]},env,timeout:45000});
  try{
    const page=application.windows().find(p=>p.url().startsWith('file:'))??await application.waitForEvent('window',{predicate:p=>!p.url().startsWith('data:')});
    await expect(page.getByTestId('workspace')).toBeVisible();
    await page.getByRole('navigation').getByRole('button',{name:'Cài đặt',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Google Sheets',exact:true})).toBeVisible();
    await expect(page.getByRole('alert').filter({hasText:'GATEWAY_CONFIGURATION_REQUIRED'})).toBeVisible();
    expect(await page.evaluate(()=>window.desktop.inbox.request({path:'sheets'}))).toMatchObject({ok:false});
    expect(await page.evaluate(()=>window.desktop.inbox.request({path:'sheets/../../connector/claim',body:{}}))).toMatchObject({ok:false});
    expect(await page.evaluate(()=>Object.keys(window.desktop).some(key=>/googleToken|privateKey/i.test(key)))).toBe(false);
  }finally{await application.close();}
});
test('fixture-only Sheets Settings renders counters, redaction, check and sync actions',async()=>{
  const env:Record<string,string>={};for(const [key,value] of Object.entries(process.env))if(value!==undefined&&!['ELECTRON_RUN_AS_NODE','PVH_GATEWAY_URL','PVH_GATEWAY_CREDENTIAL'].includes(key))env[key]=value;
  env.PVH_GATEWAY_URL='https://fixture.invalid';env.PVH_GATEWAY_CREDENTIAL='a'.repeat(64);env.PVH_USER_DATA=mkdtempSync(join(tmpdir(),'pvh-sheets-ui-fixture-'));
  const application=await electron.launch({...process.env.PVH_PACKAGED?{executablePath:resolve('dist/win-unpacked/PVH Omnichannel Manager.exe')}:{args:[resolve('apps/desktop')]},env,timeout:45000});
  try{
    // Isolated main-process transport fixture. Never inject Google keys or fixture switches into production.
    await application.evaluate(()=>{
      const original=globalThis.fetch;const snapshot={config:{spreadsheet_id:'fixtureSpreadsheet1234567890',enabled:0,redact:1,verified_at:Date.now(),last_sync_at:null,error:null,next_attempt:0},credential:{client_email:'fixture@example.iam.gserviceaccount.com'},counts:{total:7,pending:4,success:2,failed:1},logs:[{id:1,code:'FIXTURE_ONLY',record_count:0,created_at:Date.now()}]};
      globalThis.fetch=(async(input,init)=>{
        const url=String(input);
        if(url==='https://fixture.invalid/auth/login')return Response.json({accessToken:'a'.repeat(64),refreshToken:'b'.repeat(64),accessExpires:Date.now()+900000,expiresAt:Date.now()+86400000,principal:{org_id:'fixture-org',user_id:'admin',role:'admin'}});
        if(!url.startsWith('https://fixture.invalid/api/inbox/sheets'))return original(input,init);
        if(url.endsWith('/enabled'))snapshot.config.enabled=JSON.parse(String(init?.body)).enabled?1:0;
        if(url.endsWith('/sync')||url.endsWith('/retry')){snapshot.counts={total:7,pending:0,success:7,failed:0};snapshot.config.last_sync_at=Date.now() as never;}
        return Response.json(url.endsWith('/sheets')?snapshot:{saved:true});
      }) as typeof fetch;
    });
    const page=application.windows().find(p=>p.url().startsWith('file:'))??await application.waitForEvent('window',{predicate:p=>!p.url().startsWith('data:')});await expect(page.getByTestId('workspace')).toBeVisible();
    expect(await page.evaluate(()=>window.desktop.auth.login({email:'fixture@example.com',password:'fixture password only'}))).toMatchObject({ok:true});
    await page.getByRole('navigation').getByRole('button',{name:'Cài đặt',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Đang chờ: 4'})).toBeVisible();await expect(page.getByLabel('Ẩn dữ liệu nhạy cảm trên Sheets')).toBeChecked();
    await page.getByRole('button',{name:'Kết nối / Kiểm tra quyền / Tạo tab',exact:true}).click();
    await page.getByRole('button',{name:'Bật đồng bộ',exact:true}).click();await expect(page.getByRole('button',{name:'Tắt đồng bộ',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Đồng bộ ngay',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Thành công: 7'})).toBeVisible();
  }finally{await application.close();}
});