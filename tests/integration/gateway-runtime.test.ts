/// <reference types="@cloudflare/workers-types" />
import { getPlatformProxy } from 'wrangler';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app, maintenance } from '../../apps/gateway/src/index';
import { digest, encrypt, hmac, hex } from '../../apps/gateway/src/security';
import { processEvents } from '../../apps/gateway/src/webhook';
import type { Env } from '../../apps/gateway/src/types';
const directory = mkdtempSync(join(tmpdir(), 'pvh-d1-phase03-'));
let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>; let env: Env;
const tasks: Promise<unknown>[] = [];
const ctx = { waitUntil: (task: Promise<unknown>) => tasks.push(task), passThroughOnException: () => {} } as unknown as ExecutionContext;
beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ configPath: resolve('apps/gateway/wrangler.jsonc'), persist: { path: directory } });
  env = { ...proxy.env, META_APP_ID: '999', META_APP_SECRET: 'fixture-only', META_VERIFY_TOKEN: 'verify-fixture', TOKEN_ENCRYPTION_KEY: btoa('k'.repeat(32)), PUBLIC_ORIGIN: 'https://gateway.example' };
  for (const file of ['0001_facebook.sql','0002_inbox.sql','0003_sheets.sql','0004_multiagent.sql']) {
    const migration = readFileSync(resolve(`apps/gateway/migrations/${file}`), 'utf8').replace(/--[^\n]*/g,'');
    const statements = migration.split(/(CREATE TRIGGER[\s\S]*?END;)/).flatMap(part=>part.trim().startsWith('CREATE TRIGGER')?[part]:part.split(';')).map(sql=>sql.trim()).filter(Boolean);
    await env.DB.batch(statements.map(sql => env.DB.prepare(sql.trim())));
  }
});
afterAll(async () => { await Promise.allSettled(tasks); await proxy?.dispose(); rmSync(directory, { recursive: true, force: true }); });
it('real workerd D1: Sheets trigger revisions, immutable row mapping and tenant admin guard',async()=>{
  const credential='9'.repeat(64);
  await env.DB.prepare('INSERT INTO gateway_credentials VALUES(?,?,?,?,?,0)').bind(await digest(credential),'sheets-org','admin','admin',Date.now()+600000).run();
  const req=(path:string,body?:unknown)=>app.request(`https://gateway.example/api/inbox/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json','X-Device-ID':'11111111-1111-4111-8111-111111111119','X-Connector-Fence':'11111111-1111-4111-8111-111111111118'},...(body===undefined?{}:{body:JSON.stringify(body)})},env,ctx);
  const channelId=crypto.randomUUID();expect((await req('connector/register',{accountId:channelId,name:'Sheets fixture',connectorUserId:'admin'})).status).toBe(200);
  await env.DB.prepare('INSERT INTO connector_leases VALUES(?,?,?,?,?,?)').bind('sheets-org',channelId,'11111111-1111-4111-8111-111111111119','admin','11111111-1111-4111-8111-111111111118',Date.now()+90000).run();
  const payload={channelId,messageId:'d1-sheets',threadId:'123',threadType:0,senderId:'123',senderName:'Fixture',isSelf:false,text:'=test',timestamp:Date.now(),attachment:null,status:'RECEIVED'};
  expect((await req('connector/ingest',payload)).status).toBe(200);
  const first=await env.DB.prepare("SELECT row_index,revision,synced_revision FROM sheets_outbox WHERE organization_id='sheets-org' AND tab='MESSAGES'").first();expect(first).toMatchObject({row_index:2,revision:1,synced_revision:0});
  await env.DB.prepare("UPDATE messages SET send_status='READ' WHERE organization_id='sheets-org'").run();
  expect(await env.DB.prepare("SELECT row_index,revision FROM sheets_outbox WHERE organization_id='sheets-org' AND tab='MESSAGES'").first()).toMatchObject({row_index:2,revision:2});
  const snapshot=await req('sheets');expect(snapshot.status).toBe(200);expect(await snapshot.json()).toMatchObject({config:null,counts:{pending:3,success:0}});
  expect(await env.DB.prepare("SELECT json_valid(payload) AS valid FROM sheets_outbox WHERE organization_id='sheets-org' LIMIT 1").first('valid')).toBe(1);
});
it('real workerd D1: migration, authenticated routes, signature, durable duplicate prevention and replay', async () => {
  const credential = 'a'.repeat(64); const now = Date.now();
  await env.DB.prepare('INSERT INTO gateway_credentials VALUES(?,?,?,?,?,0)').bind(await digest(credential), 'org1', 'employee1', 'admin', now + 600000).run();
  const ciphertext = await encrypt(env.TOKEN_ENCRYPTION_KEY, 'fixture-page-token', 'page:org1:123');
  await env.DB.prepare("INSERT INTO fb_pages(id,org_id,page_id,name,token,status,permissions,owner_id) VALUES('conn1','org1','123','Fixture',?,'CHECK_REQUIRED','[]','employee1')").bind(ciphertext).run();
  expect((await app.request('https://gateway.example/api/facebook/pages', {}, env, ctx)).status).toBe(401);
  const list = await app.request('https://gateway.example/api/facebook/pages', { headers: { Authorization: `Bearer ${credential}` } }, env, ctx);
  expect(list.status).toBe(200); expect(await list.text()).not.toContain(ciphertext);
  const payload = JSON.stringify({ object: 'page', entry: [{ id: '123', messaging: [{ sender: { id: '456' }, recipient: { id: '123' }, timestamp: now, message: { mid: 'real-d1-mid', text: 'D1 tiáº¿ng Viá»‡t' } }] }] });
  const signature = `sha256=${hex(await hmac(env.META_APP_SECRET, new TextEncoder().encode(payload).buffer))}`;
  const post = () => app.request('https://gateway.example/meta/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': signature }, body: payload }, env, ctx);
  expect((await post()).status).toBe(200); await post(); await Promise.all(tasks); await processEvents(env);
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM fb_events').first('count')).toBe(1);
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM fb_messages').first('count')).toBe(1);
  expect(await env.DB.prepare('SELECT text FROM fb_messages').first('text')).toBe('D1 tiáº¿ng Viá»‡t');
  await maintenance(env);
});
it('real D1 UPDATE RETURNING consumes OAuth state atomically', async () => {
  const stateHash = await digest('test-state');
  await env.DB.prepare("INSERT INTO fb_oauth(id,state_hash,org_id,user_id,expires_at,status,created_at) VALUES('tx',?,'org1','employee1',?,'PENDING',?)").bind(stateHash, Date.now() + 300000, Date.now()).run();
  const claim = () => env.DB.prepare("UPDATE fb_oauth SET status='EXCHANGING' WHERE state_hash=? AND status='PENDING' AND expires_at>? RETURNING id").bind(stateHash, Date.now()).first();
  const results = await Promise.all([claim(), claim()]); expect(results.filter(Boolean)).toHaveLength(1);
});
it('real workerd D1 unified Zalo job, role enforcement, identity and durable dedup', async () => {
  const credential='f'.repeat(64);const agent='b'.repeat(64);const viewer='c'.repeat(64);
  for(const [token,user,role] of [[credential,'connector','admin'],[agent,'agent','agent'],[viewer,'viewer','viewer']])await env.DB.prepare('INSERT INTO gateway_credentials VALUES(?,?,?,?,?,0)').bind(await digest(token!), 'phase4-org',user!,role!,Date.now()+600000).run();
  const channelId='33333333-3333-4333-8333-333333333333';
  const request=(path:string,body?:unknown,token=credential)=>app.request(`https://gateway.example/api/inbox/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Device-ID':'11111111-1111-4111-8111-111111111119','X-Connector-Fence':'11111111-1111-4111-8111-111111111118'},...(body===undefined?{}:{body:JSON.stringify(body)})},env,ctx);
  expect((await request('connector/register',{accountId:channelId,name:'Workerd fixture only',connectorUserId:'connector'})).status).toBe(200);
  for(const userId of ['agent','viewer'])expect((await request('grants',{channelId,userId,allowed:true})).status).toBe(200);
  await env.DB.prepare('INSERT INTO connector_leases VALUES(?,?,?,?,?,?)').bind('phase4-org',channelId,'11111111-1111-4111-8111-111111111119','connector','11111111-1111-4111-8111-111111111118',Date.now()+90000).run();
  const incoming={channelId,messageId:'mid-workerd',threadId:'123',threadType:0,senderId:'123',senderName:'Workerd fixture',isSelf:false,text:'Xin chÃ o ðŸ‡»ðŸ‡³',timestamp:Date.now()-1000,attachment:null,status:'RECEIVED'};
  expect((await request('connector/ingest',incoming)).status).toBe(200);expect((await request('connector/ingest',incoming)).status).toBe(200);
  const conversationId=`zalo:${channelId}:123`;const requestId=crypto.randomUUID();
  expect((await request(`conversations/${conversationId}/send`,{requestId,text:'Reply',version:0},viewer)).status).toBe(403);
  const response=await request(`conversations/${conversationId}/send`,{requestId,text:'Reply',version:0},agent);expect(response.status,await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({status:'PENDING'});
  const claim=await request('connector/claim',{channelId});expect(await claim.json()).toMatchObject({job:{id:requestId,agent_id:'agent'}});
  expect((await request('connector/result',{jobId:requestId,status:'SENT',messageId:'result-workerd'})).status).toBe(200);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE organization_id=?').bind('phase4-org').first('n')).toBe(2);
  expect(await env.DB.prepare("SELECT agent_id FROM messages WHERE organization_id=? AND direction='outgoing'").bind('phase4-org').first('agent_id')).toBe('agent');
});