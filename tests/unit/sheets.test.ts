/// <reference types="@cloudflare/workers-types" />
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { app } from '../../apps/gateway/src/index';
import { digest, encrypt, decrypt } from '../../apps/gateway/src/security';
import { syncSheets, googleToken, SHEETS_HEADERS } from '../../apps/gateway/src/sheets';
import type { Env } from '../../apps/gateway/src/types';
import { parseIpc } from '../../packages/shared/schemas';

class Binding {
  sql=new DatabaseSync(':memory:');
  constructor(){for(const file of ['0001_facebook.sql','0002_inbox.sql','0003_sheets.sql','0004_multiagent.sql'])this.sql.exec(readFileSync(new URL(`../../apps/gateway/migrations/${file}`,import.meta.url),'utf8'));}
  prepare(query:string){let values:SQLInputValue[]=[];const statement={bind:(...input:SQLInputValue[])=>{values=input;return statement;},first:async()=>this.sql.prepare(query).get(...values)??null,all:async()=>({results:this.sql.prepare(query).all(...values),success:true}),run:async()=>({success:true,meta:{changes:Number(this.sql.prepare(query).run(...values).changes)},results:[]})};return statement;}
  async batch(statements:ReturnType<Binding['prepare']>[]){this.sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());this.sql.exec('COMMIT');return results;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
let db:Binding;let env:Env;let cells:Map<string,unknown[]>;let writes:{valueInputOption:string;data:{range:string;values:unknown[][]}[]}[];
let failure:number|'offline'|'timeout-after-write'|null;let afterWrite:(()=>void)|null;let tabsExist:boolean;
const admin='a'.repeat(64),agent='b'.repeat(64),other='c'.repeat(64);const spreadsheet='fixtureSpreadsheet1234567890';
const tasks:Promise<unknown>[]=[];const ctx={waitUntil:(task:Promise<unknown>)=>tasks.push(task),passThroughOnException:vi.fn()} as unknown as ExecutionContext;
const api=(path='',body?:unknown,token=admin)=>app.request(`https://gateway.example/api/inbox/sheets${path?'/'+path:''}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env,ctx);
function message(id:string,platform='zalo',outgoing=false,known=true){
  db.sql.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'org',platform,platform,platform,id,outgoing?'outgoing':'incoming','=IMPORTXML("private")','customer',outgoing?'Agent':'Customer',outgoing?'agent':'customer',outgoing&&known?'agent':null,outgoing&&known?'Agent':null,outgoing&&known?'desktop_agent':outgoing?'zalo_native':'external',outgoing&&known?'verified':'unknown',Date.now(),Date.now(),outgoing?'SENT':'RECEIVED',Date.now());
}
function projection(tab:string){return db.sql.prepare('SELECT * FROM sheets_outbox WHERE tab=? ORDER BY row_index').all(tab);}
function fixtureGoogle(){
  return vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const url=new URL(String(input));expect(url.origin).toBe('https://sheets.googleapis.com');expect(url.pathname).toContain(`/v4/spreadsheets/${spreadsheet}`);expect(init?.redirect).toBe('error');
    if(failure==='offline')throw new TypeError('secret must never reach logs');
    if(typeof failure==='number')return new Response(JSON.stringify({error:{message:'sensitive upstream details'}}),{status:failure,headers:{'Retry-After':'120'}});
    if(url.pathname.endsWith('/values:batchUpdate')){
      const body=JSON.parse(String(init?.body));writes.push(body);expect(body.valueInputOption).toBe('RAW');
      for(const item of body.data)cells.set(item.range,item.values[0]);
      afterWrite?.();afterWrite=null;
      if(failure==='timeout-after-write'){failure=null;throw new DOMException('ambiguous','TimeoutError');}
      return Response.json({responses:body.data.map((d:{range:string})=>({updatedRange:d.range,updatedRows:1}))});
    }
    if(url.pathname.endsWith('/values:batchGet'))return Response.json({valueRanges:url.searchParams.getAll('ranges').map(range=>({range,values:cells.has(range)?[cells.get(range)]:[]}))});
    if(url.pathname.endsWith(':batchUpdate')){tabsExist=true;return Response.json({replies:[]});}
    return Response.json({spreadsheetId:spreadsheet,sheets:tabsExist?Object.entries(SHEETS_HEADERS).map(([title,headers],sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:10000,columnCount:headers.length}}})):[]});
  });
}
beforeEach(async()=>{
  db=new Binding();env={DB:db as unknown as D1Database,META_APP_ID:'',META_APP_SECRET:'',META_VERIFY_TOKEN:'',PUBLIC_ORIGIN:'https://gateway.example',TOKEN_ENCRYPTION_KEY:btoa('k'.repeat(32))};
  for(const [token,org,user,role] of [[admin,'org','admin','admin'],[agent,'org','agent','agent'],[other,'other','admin','admin']])db.sql.prepare('INSERT INTO gateway_credentials VALUES(?,?,?,?,?,0)').run(await digest(token!),org!,user!,role!,Date.now()+3600000);
  for(const platform of ['zalo','facebook']){
    db.sql.prepare('INSERT INTO channel_connections VALUES(?,?,?,?,?,NULL)').run(platform,'org',platform,platform,platform);
    db.sql.prepare('INSERT INTO customers(id,organization_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(platform,'org','Customer',Date.now(),Date.now());
    db.sql.prepare('INSERT INTO customer_identities VALUES(?,?,?,?,?,?)').run(platform,'org',platform,platform,platform,'private-id');
    db.sql.prepare('INSERT INTO conversations(id,organization_id,channel_id,customer_id,external_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(platform,'org',platform,platform,'external',Date.now(),Date.now());
  }
  db.sql.prepare('INSERT INTO sheets_credentials VALUES(?,?,?,?,?)').run('org','fixture@example.iam.gserviceaccount.com','unused-key',await encrypt(env.TOKEN_ENCRYPTION_KEY,'fixture-access-token','sheets:org'),Date.now()+3600000);
  db.sql.prepare('INSERT INTO sheets_config(organization_id,spreadsheet_id,enabled,redact,verified_at) VALUES(?,?,1,0,?)').run('org',spreadsheet,Date.now());
  cells=new Map();for(const [tab,header] of Object.entries(SHEETS_HEADERS))cells.set(`${tab}!A1:${String.fromCharCode(64+header.length)}1`,[...header]);
  writes=[];failure=null;afterWrite=null;tabsExist=true;tasks.length=0;fixtureGoogle();
});
afterEach(async()=>{await Promise.allSettled(tasks);vi.restoreAllMocks();db.sql.close();});

it('A-D: logs incoming/outgoing on both platforms once and updates a stable row',async()=>{
  for(const platform of ['zalo','facebook']){message(`${platform}-in`,platform);message(`${platform}-out`,platform,true);}
  expect(projection('MESSAGES')).toHaveLength(4);await syncSheets(env,'org');
  const rows=[...cells.entries()].filter(([key])=>key.startsWith('MESSAGES!A')&&!key.includes('A1:'));
  expect(rows).toHaveLength(4);expect(rows.filter(([,row])=>row[6]==='incoming')).toHaveLength(2);expect(rows.filter(([,row])=>row[6]==='outgoing')).toHaveLength(2);
  const mapping=projection('MESSAGES');db.sql.exec("UPDATE messages SET send_status='READ' WHERE id='facebook-out'");await syncSheets(env,'org');expect(projection('MESSAGES').map(r=>r.row_index)).toEqual(mapping.map(r=>r.row_index));
  expect([...cells.values()].some(r=>r[0]==='facebook-out'&&r[15]==='READ')).toBe(true);
  expect(writes.flatMap(w=>w.data).some(d=>d.values[0]?.[11]==='=IMPORTXML("private")')).toBe(true);
});
it('E: leaves unknown native agent blank, masks sensitive content and omits media URLs',async()=>{
  message('native','zalo',true,false);db.sql.exec('UPDATE sheets_config SET redact=1');await syncSheets(env,'org');
  const row=cells.get('MESSAGES!A2:Q2')!;expect(row[9]).toBe('');expect(row[10]).toBe('');expect(row[11]).toBe('');expect(row[12]).toBe('');expect(row[16]).toBe('unknown');
});
it('F: network failure preserves the source and pending revision across a restart',async()=>{
  message('offline');failure='offline';await syncSheets(env,'org');
  expect(db.sql.prepare('SELECT COUNT(*) AS n FROM messages').get()).toMatchObject({n:1});expect(projection('MESSAGES')[0]).toMatchObject({synced_revision:0,error:'SHEETS_RETRY_NETWORK',attempts:1});
  const response=await api();expect(await response.text()).not.toContain('secret');
  failure=null;db.sql.exec('UPDATE sheets_config SET next_attempt=0; UPDATE sheets_outbox SET next_attempt=0');await syncSheets(env,'org');expect(projection('MESSAGES')[0]).toMatchObject({synced_revision:1,error:null});
});
it('G: ambiguous timeout retries the same row, readback confirms and no append occurs',async()=>{
  message('timeout');failure='timeout-after-write';await syncSheets(env,'org');expect(projection('MESSAGES')[0]?.synced_revision).toBe(0);
  db.sql.exec('UPDATE sheets_config SET next_attempt=0; UPDATE sheets_outbox SET next_attempt=0');await syncSheets(env,'org');
  expect(writes).toHaveLength(2);expect(writes[1]?.data.map(d=>d.range)).toEqual(writes[0]?.data.map(d=>d.range));expect(cells.get('MESSAGES!A2:Q2')?.[0]).toBe('timeout');expect(projection('MESSAGES')).toHaveLength(1);
});
it.each([[401,'SHEETS_RECONNECT_REQUIRED'],[403,'SHEETS_PERMISSION_DENIED'],[404,'SHEETS_NOT_FOUND']] as const)('H-I: HTTP %s pauses sync with safe code %s',async(status,code)=>{
  message('error');failure=status;await syncSheets(env,'org');expect(db.sql.prepare('SELECT enabled,error,verified_at FROM sheets_config').get()).toMatchObject({enabled:0,error:code,verified_at:null});
  if(status===401)expect(db.sql.prepare('SELECT encrypted_token FROM sheets_credentials').get()?.encrypted_token).toBeNull();
  expect((await (await api()).text())).not.toContain('sensitive upstream');
});
it('J: quota uses backoff and manual retry cannot bypass it',async()=>{
  message('quota');failure=429;await syncSheets(env,'org');const config=db.sql.prepare('SELECT * FROM sheets_config').get()!;
  expect(config.enabled).toBe(1);expect(config.error).toBe('SHEETS_RETRY_QUOTA');expect(Number(config.next_attempt)).toBeGreaterThanOrEqual(Date.now()+119000);
  const count=vi.mocked(fetch).mock.calls.length;await syncSheets(env,'org');expect(vi.mocked(fetch).mock.calls.length).toBe(count);expect(await (await api('retry',{})).json()).toMatchObject({error:'SHEETS_BACKOFF_ACTIVE'});
});
it('enqueues source and projections atomically; a rollback emits no phantom row',()=>{
  db.sql.exec('BEGIN');message('rolled-back');expect(projection('MESSAGES')).toHaveLength(1);db.sql.exec('ROLLBACK');expect(projection('MESSAGES')).toHaveLength(0);expect(db.sql.prepare('SELECT * FROM messages').all()).toHaveLength(0);
});
it('cannot ACK a revision that changed while Google was in flight',async()=>{
  message('racing');afterWrite=()=>db.sql.exec("UPDATE messages SET send_status='DELIVERED' WHERE id='racing'");await syncSheets(env,'org');
  expect(projection('MESSAGES')[0]).toMatchObject({revision:2,synced_revision:0});await syncSheets(env,'org');expect(projection('MESSAGES')[0]).toMatchObject({revision:2,synced_revision:2});expect(cells.get('MESSAGES!A2:Q2')?.[15]).toBe('DELIVERED');
});
it('locks concurrent workers and keeps disabled outbox durable',async()=>{
  message('locked');db.sql.prepare('UPDATE sheets_config SET lease_until=?').run(Date.now()+60000);await syncSheets(env,'org');expect(writes).toHaveLength(0);
  db.sql.exec('UPDATE sheets_config SET lease_until=0,enabled=0');await syncSheets(env,'org');expect(writes).toHaveLength(0);await syncSheets(env,'org',true);expect(writes).toHaveLength(1);
});
it('admin-only API, fixed destination, IPC allowlist and no secret exposure',async()=>{
  expect((await api('',undefined,agent)).status).toBe(403);expect((await api('configure',{spreadsheetId:spreadsheet,redact:true},agent)).status).toBe(403);
  expect(await (await api('',undefined,other)).json()).toMatchObject({config:null,credential:null});
  expect(await (await api('configure',{spreadsheetId:'differentSpreadsheet123456',redact:true})).json()).toMatchObject({error:'SHEETS_DESTINATION_IMMUTABLE'});
  const snapshot=await (await api()).text();expect(snapshot).not.toContain('fixture-access-token');expect(snapshot).not.toContain('encrypted_key');
  expect(()=>parseIpc('inbox:request',{path:'sheets/check',body:{}})).not.toThrow();expect(()=>parseIpc('inbox:request',{path:'sheets/../connector/claim',body:{}})).toThrow();
});
it('creates missing tabs, tests write permission, and refuses incorrect headers',async()=>{
  cells.clear();tabsExist=false;expect((await api('check',{})).status).toBe(200);expect(writes[0]?.data).toHaveLength(4);
  cells.set('MESSAGES!A1:Q1',['wrong']);expect(await (await api('check',{})).json()).toMatchObject({error:'SHEETS_HEADER_CONFLICT'});expect(db.sql.prepare('SELECT enabled,verified_at FROM sheets_config').get()).toMatchObject({enabled:0,verified_at:null});
});
it('early echo deletion clears its projection row rather than leaving a duplicate',async()=>{
  message('pending','zalo',true);message('echo','zalo',true,false);await syncSheets(env,'org');db.sql.exec("DELETE FROM messages WHERE id='echo'");await syncSheets(env,'org');expect(cells.get('MESSAGES!A3:Q3')).toEqual(Array(17).fill(''));expect(db.sql.prepare('SELECT COUNT(*) AS n FROM messages').get()).toMatchObject({n:1});
});
it('JWT service account refresh is signed, encrypted at rest and reused before expiry',async()=>{
  const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const raw=await crypto.subtle.exportKey('pkcs8',key.privateKey);const pem=`-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(raw)))}\n-----END PRIVATE KEY-----`;
  db.sql.prepare('UPDATE sheets_credentials SET encrypted_key=?,encrypted_token=NULL,token_expires_at=0').run(await encrypt(env.TOKEN_ENCRYPTION_KEY,pem,'sheets:org'));
  vi.mocked(fetch).mockImplementation(async(input,init)=>{
    expect(String(input)).toBe('https://oauth2.googleapis.com/token');const jwt=new URLSearchParams(String(init?.body)).get('assertion')!;const [header,payload,signature]=jwt.split('.');
    const decode=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key.publicKey,decode(signature!),new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(decode(payload!)))).toMatchObject({aud:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/spreadsheets'});
    return Response.json({access_token:'renewed-secret',expires_in:3600});
  });
  expect(await googleToken(env,'org')).toBe('renewed-secret');expect(await googleToken(env,'org')).toBe('renewed-secret');expect(fetch).toHaveBeenCalledTimes(1);
  const stored=db.sql.prepare('SELECT encrypted_token FROM sheets_credentials').get()!.encrypted_token as string;expect(stored).not.toContain('renewed-secret');expect(await decrypt(env.TOKEN_ENCRYPTION_KEY,stored,'sheets:org')).toBe('renewed-secret');
});
it('refuses to overwrite a moved logical row',async()=>{
  message('correct');cells.set('MESSAGES!A2:Q2',['someone-else']);await syncSheets(env,'org');
  expect(writes).toHaveLength(0);expect(db.sql.prepare('SELECT error,enabled FROM sheets_config').get()).toMatchObject({error:'SHEETS_ROW_CONFLICT',enabled:0});
});
it('batches at most 100 rows and resumes the remainder from a durable checkpoint',async()=>{
  for(let i=0;i<105;i++)message(`bulk-${i}`);await syncSheets(env,'org');expect(writes[0]?.data).toHaveLength(100);
  const pending=Number(db.sql.prepare('SELECT COUNT(*) AS n FROM sheets_outbox WHERE revision>synced_revision').get()?.n);expect(pending).toBeGreaterThan(0);
  await syncSheets(env,'org');expect(db.sql.prepare('SELECT COUNT(*) AS n FROM sheets_outbox WHERE revision>synced_revision').get()).toMatchObject({n:0});
});
it('does not adopt a populated spreadsheet even when its headers look valid',async()=>{
  cells.set('MESSAGES!A2:Q',[['preexisting']]);expect(await (await api('check',{})).json()).toMatchObject({error:'SHEETS_TAB_NOT_EMPTY'});expect(writes).toHaveLength(0);
});
it('redaction changes invalidate confirmed revisions and rewrite the same rows',async()=>{
  message('privacy');await syncSheets(env,'org');expect(cells.get('MESSAGES!A2:Q2')?.[11]).not.toBe('');
  expect((await api('configure',{spreadsheetId:spreadsheet,redact:true})).status).toBe(200);
  db.sql.exec('UPDATE sheets_config SET initialized=1');expect((await api('check',{})).status).toBe(200);await syncSheets(env,'org',true);expect(cells.get('MESSAGES!A2:Q2')?.[11]).toBe('');expect(projection('MESSAGES')).toHaveLength(1);
});
it('reports confirmed sends and first-response seconds without assigning native messages',async()=>{
  message('in');db.sql.prepare("UPDATE messages SET source_created_at=? WHERE id='in'").run(Date.UTC(2026,9,18,8));
  message('reply','zalo',true);db.sql.prepare("UPDATE messages SET source_created_at=? WHERE id='reply'").run(Date.UTC(2026,9,18,8)+30000);
  message('native-report','zalo',true,false);message('failed','zalo',true);db.sql.exec("UPDATE messages SET send_status='FAILED' WHERE id='failed'");
  const report=db.sql.prepare("SELECT payload FROM sheets_agent_reports WHERE json_extract(payload,'$[3]')='2026-10-18'").get()!;
  const row=JSON.parse(String(report.payload));expect(row.slice(0,4)).toEqual(['agent','agent','zalo','2026-10-18']);expect(row[5]).toBe(1);expect(row[6]).toBe(1);expect(row[7]).toBe(30);
  db.sql.exec("UPDATE conversations SET status='RESOLVED' WHERE id='zalo'");expect(db.sql.prepare("SELECT resolved_at FROM conversations WHERE id='zalo'").get()?.resolved_at).toBeGreaterThan(0);
  db.sql.exec("UPDATE conversations SET status='OPEN' WHERE id='zalo'");expect(db.sql.prepare("SELECT resolved_at FROM conversations WHERE id='zalo'").get()?.resolved_at).toBeNull();
});
it('migration backfills messages created before Phase 05',()=>{
  const legacy=new DatabaseSync(':memory:');
  try{
    for(const file of ['0001_facebook.sql','0002_inbox.sql'])legacy.exec(readFileSync(new URL(`../../apps/gateway/migrations/${file}`,import.meta.url),'utf8'));
    legacy.exec("INSERT INTO channel_connections VALUES('legacy','org','zalo','legacy','Legacy',NULL); INSERT INTO customers(id,organization_id,name,created_at,updated_at) VALUES('legacy','org','Customer',1,1); INSERT INTO customer_identities VALUES('legacy','org','legacy','zalo','legacy','external'); INSERT INTO conversations(id,organization_id,channel_id,customer_id,external_id,created_at,updated_at) VALUES('legacy','org','legacy','legacy','external',1,1); INSERT INTO messages VALUES('legacy','org','zalo','legacy','legacy','legacy','incoming','original','external','Customer','customer',NULL,NULL,'external','unknown',1,1,'RECEIVED',1)");
    legacy.exec(readFileSync(new URL('../../apps/gateway/migrations/0003_sheets.sql',import.meta.url),'utf8'));
    expect(legacy.prepare("SELECT row_index,revision,synced_revision FROM sheets_outbox WHERE tab='MESSAGES'").get()).toMatchObject({row_index:2,revision:1,synced_revision:0});expect(legacy.prepare('SELECT content FROM messages').get()?.content).toBe('original');
  }finally{legacy.close();}
});