import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import { join, resolve } from 'node:path';

test('short real Electron idle sample, startup and variable-height virtual timeline burst', async () => {
  test.setTimeout(90_000);
  const directory = mkdtempSync(join(tmpdir(), 'pvh-perf-'));
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, PVH_USER_DATA: directory, PVH_GATEWAY_URL: 'https://fixture.invalid' }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  const start = performance.now();
  const application = await electron.launch({ ...(process.env.PVH_PACKAGED ? { executablePath: resolve('dist/win-unpacked/PVH Omnichannel Manager.exe') } : { args: [resolve('apps/desktop')] }), env, timeout: 45_000 });
  try {
    let page = application.windows().find(w => w.url().startsWith('file:'));
    if (!page) page = await application.waitForEvent('window', { predicate: w => w.url().startsWith('file:') });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('workspace')).toBeVisible();
    const startupMs = performance.now() - start;
    // Exclude startup/backup and prime CPU counters before a 10-second idle sample.
    await page.waitForTimeout(5000);
    await application.evaluate(({ app }) => app.getAppMetrics());
    await page.waitForTimeout(10000);
    const idle = await application.evaluate(({ app }) => app.getAppMetrics());
    await application.evaluate(() => {
      const state = globalThis as typeof globalThis & { performanceBurst?: boolean };
      state.performanceBurst = false;
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = new URL(String(input)); const now = 1_790_000_000_000;
        if (url.origin !== 'https://fixture.invalid') throw new Error('FIXTURE_NETWORK_DENIED');
        if (url.pathname === '/auth/login') return Response.json({ accessToken: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accessExpires: Date.now()+900000, expiresAt:Date.now()+86400000, principal:{org_id:'test',user_id:'agent',role:'agent'} });
        const path = url.pathname.replace('/api/inbox/', '');
        const row = {id:'stress',channel_id:'test',customer_id:'test',external_id:'1',name:'Stress timeline',platform:'zalo',channel_name:'Test',status:'OPEN',version:0,updated_at:now,created_at:now,preview:'Test',unread:0};
        if (path === 'session') return Response.json({principal:{org_id:'test',user_id:'agent',role:'agent'},channels:[],members:[]});
        if (path === 'conversations') return Response.json({items:[row],next:null});
        if (path.endsWith('/jobs')) return Response.json({jobs:[]});
        if (path.endsWith('/draft') || path.endsWith('/read')) return Response.json({saved:true});
        if (path === 'conversations/stress') return Response.json({conversation:row,customer:{id:'test',name:'Test',tags:'[]',care_notes:'',version:0},messages:Array.from({length:state.performanceBurst?300:200},(_,i)=>({id:String(i),direction:'incoming',content:i===299?'BURST_LAST':`Message ${i} `+'variable height '.repeat(i%12),sender_name:'Test',source_created_at:now+i,received_at:now+i,send_status:'RECEIVED',attachments:'[]',sender_origin:'external',attribution_status:'unknown',agent_id:null})),next:null,draft:'',notes:[],history:[],stats:{incoming:200,outgoing:0,first_response_ms:null}});
        return Response.json({error:'FIXTURE_UNHANDLED'}, {status:404});
      }) as typeof fetch;
    });
    await page.getByLabel('Email đăng nhập').fill('test@example.com');
    await page.getByLabel('Mật khẩu đăng nhập', { exact:true }).fill('test-only');
    await page.getByRole('button', {name:'Đăng nhập',exact:true}).click();
    await page.getByRole('navigation').getByRole('button', {name:'Hộp thư chung',exact:true}).click();
    await page.getByRole('button', {name:/Stress timeline/}).click();
    const timeline = page.getByLabel('Timeline tin nhắn', {exact:true});
    await expect(timeline.locator('article').first()).toBeVisible();
    expect(await timeline.locator('article').count()).toBeLessThan(40);
    const burstStart = performance.now();
    await application.evaluate(() => { (globalThis as typeof globalThis & {performanceBurst?:boolean}).performanceBurst = true; });
    // Remount triggers an authorized bounded detail read; no production test hook is added.
    await page.getByRole('navigation').getByRole('button', {name:'Tổng quan',exact:true}).click();
    await page.getByRole('navigation').getByRole('button', {name:'Hộp thư chung',exact:true}).click();
    await page.getByRole('button', {name:/Stress timeline/}).click();
    await expect.poll(async () => {
      await timeline.evaluate(element => { element.scrollTop = element.scrollHeight; });
      return timeline.getByText('BURST_LAST', {exact:true}).isVisible();
    }).toBe(true);
    await expect(timeline.getByText('BURST_LAST', {exact:true})).toBeVisible();
    const remountBurstRenderMs = performance.now()-burstStart;
    expect(await timeline.locator('article').count()).toBeLessThan(40);
    expect(errors).toEqual([]);
    mkdirSync('artifacts', {recursive:true});
    writeFileSync(`artifacts/phase07-electron${process.env.PVH_PACKAGED ? '-packaged' : ''}.json`, JSON.stringify({measuredAt:new Date().toISOString(),hardware:{cpu:cpus()[0]?.model,logicalCpus:cpus().length,ramBytes:totalmem(),os:release()},scenario:`${process.env.PVH_PACKAGED ? 'packaged' : 'source production build'}, empty DB, no authenticated live connector; 10s idle; simulated renderer response 200+100 messages`,startupMs,idle,remountBurstRenderMs,workerMemory:'NOT_MEASURED: worker_threads share main PID; do not sum RSS per thread',longSoak:'NOT_MEASURED'},null,2));
  } finally { await application.close(); }
});