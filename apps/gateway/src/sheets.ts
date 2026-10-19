import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Principal } from './types';
import { boundedBody, decrypt, encrypt } from './security';

export const SHEETS_HEADERS = {
  CUSTOMERS: ['customer_id','platform','platform_customer_id','customer_name','channel_account','first_seen_at','last_seen_at','total_conversations'],
  MESSAGES: ['message_id','conversation_id','platform','channel_account','customer_id','customer_name','direction','sender_name','sender_type','agent_id','agent_name','content','attachment_links','source_timestamp','received_timestamp','send_status','attribution_status'],
  CONVERSATIONS: ['conversation_id','customer_id','platform','assigned_agent','status','created_at','last_message_at','first_response_at','resolved_at','incoming_count','outgoing_count'],
  AGENT_REPORTS: ['agent_id','agent_name','platform','period','conversations_assigned','conversations_replied','messages_sent','average_response_time'],
} as const;
type Tab = keyof typeof SHEETS_HEADERS;
interface Config { organization_id:string; spreadsheet_id:string; enabled:number; redact:number; verified_at:number|null; initialized:number; last_sync_at:number|null; error:string|null; next_attempt:number; lease_token:string|null; lease_until:number }
interface RecordRow { organization_id:string; tab:Tab; logical_key:string; payload:string; row_index:number; revision:number; attempts:number }
interface Credential { client_email:string; encrypted_key:string; encrypted_token:string|null; token_expires_at:number }
const tabs = Object.keys(SHEETS_HEADERS) as Tab[];
const endColumn = (tab:Tab):string => String.fromCharCode(64+SHEETS_HEADERS[tab].length);
class SheetsError extends Error { constructor(code:string,readonly delay=0){super(code);} }
const safeCode = (e:unknown):string => e instanceof SheetsError ? e.message : 'SHEETS_RETRY_NETWORK';
const context = (org:string):string => `sheets:${org}`;
const b64url = (value:Uint8Array):string => btoa(String.fromCharCode(...value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');

export async function googleToken(env:Env,org:string):Promise<string> {
  const credential=await env.DB.prepare('SELECT * FROM sheets_credentials WHERE organization_id=?').bind(org).first<Credential>();
  if(!credential)throw new SheetsError('SHEETS_CONNECT_REQUIRED');
  if(credential.encrypted_token&&credential.token_expires_at>Date.now()+60000)return decrypt(env.TOKEN_ENCRYPTION_KEY,credential.encrypted_token,context(org));
  const pem=await decrypt(env.TOKEN_ENCRYPTION_KEY,credential.encrypted_key,context(org));
  const raw=Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g,'')),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',raw,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const now=Math.floor(Date.now()/1000); const encode=(v:unknown):string=>b64url(new TextEncoder().encode(JSON.stringify(v)));
  const jwt=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:credential.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
  const signature=b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(jwt))));
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${jwt}.${signature}`})});
  if(!response.ok)throw new SheetsError(response.status===429||response.status>=500?'SHEETS_RETRY_TOKEN':'SHEETS_RECONNECT_REQUIRED');
  const result=z.object({access_token:z.string().min(1).max(8192),expires_in:z.number().int().positive().max(86400)}).parse(await response.json());
  await env.DB.prepare('UPDATE sheets_credentials SET encrypted_token=?,token_expires_at=? WHERE organization_id=?').bind(await encrypt(env.TOKEN_ENCRYPTION_KEY,result.access_token,context(org)),Date.now()+result.expires_in*1000,org).run();
  return result.access_token;
}
interface GoogleResult {
  sheets?: {properties:{title:string;sheetId:number;gridProperties:{rowCount:number;columnCount:number}}}[];
  valueRanges?: {values?:unknown[][]}[];
  responses?: {updatedRows?:number}[];
}
async function google(env:Env,c:Config,path:string,body?:unknown):Promise<GoogleResult> {
  const token=await googleToken(env,c.organization_id);
  const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${c.spreadsheet_id}${path}`,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){
    if(response.status===401){await env.DB.prepare('UPDATE sheets_credentials SET encrypted_token=NULL,token_expires_at=0 WHERE organization_id=?').bind(c.organization_id).run();throw new SheetsError('SHEETS_RECONNECT_REQUIRED');}
    if(response.status===403){
      const error=await response.json().catch(()=>null) as {error?:{errors?:{reason?:string}[];status?:string}}|null;
      if(error?.error?.status==='RESOURCE_EXHAUSTED'||error?.error?.errors?.some(e=>['rateLimitExceeded','userRateLimitExceeded','quotaExceeded'].includes(e.reason??'')))throw new SheetsError('SHEETS_RETRY_QUOTA',60000);
      throw new SheetsError('SHEETS_PERMISSION_DENIED');
    }
    if(response.status===404)throw new SheetsError('SHEETS_NOT_FOUND');
    if(response.status===429)throw new SheetsError('SHEETS_RETRY_QUOTA',Math.min(3600000,Math.max(60000,Number(response.headers.get('Retry-After')??0)*1000||60000)));
    throw new SheetsError(response.status>=500?'SHEETS_RETRY_SERVER':'SHEETS_INVALID_LAYOUT');
  }
  return await response.json() as GoogleResult;
}
async function configuration(env:Env,org:string):Promise<Config> {
  const c=await env.DB.prepare('SELECT * FROM sheets_config WHERE organization_id=?').bind(org).first<Config>();
  if(!c)throw new SheetsError('SHEETS_CONFIG_REQUIRED');return c;
}
async function acquire(env:Env,org:string):Promise<string|null>{
  const token=crypto.randomUUID();const result=await env.DB.prepare('UPDATE sheets_config SET lease_token=?,lease_until=? WHERE organization_id=? AND lease_until<?').bind(token,Date.now()+600000,org,Date.now()).run();
  return result.meta.changes?token:null;
}
async function release(env:Env,org:string,token:string):Promise<void>{await env.DB.prepare('UPDATE sheets_config SET lease_token=NULL,lease_until=0 WHERE organization_id=? AND lease_token=?').bind(org,token).run();}
async function log(env:Env,org:string,code:string,count:number):Promise<void>{await env.DB.batch([
  env.DB.prepare('INSERT INTO sheets_logs(organization_id,code,record_count,created_at) VALUES(?,?,?,?)').bind(org,code,count,Date.now()),
  env.DB.prepare('DELETE FROM sheets_logs WHERE organization_id=? AND id NOT IN (SELECT id FROM sheets_logs WHERE organization_id=? ORDER BY id DESC LIMIT 100)').bind(org,org),
]);}
async function layout(env:Env,c:Config,records:RecordRow[],initialize=false):Promise<void>{
  const info=await google(env,c,'?fields=sheets(properties(sheetId,title,gridProperties)),spreadsheetId');
  if(!Array.isArray(info.sheets))throw new SheetsError('SHEETS_INVALID_LAYOUT');
  const requests:unknown[]=[];
  for(const tab of tabs){
    const sheet=info.sheets.find(s=>s.properties?.title===tab)?.properties;
    const maxRow=Math.max(1000,...records.filter(r=>r.tab===tab).map(r=>r.row_index));
    if(!sheet){if(!initialize||c.initialized)throw new SheetsError('SHEETS_LAYOUT_CHANGED');requests.push({addSheet:{properties:{title:tab,gridProperties:{rowCount:maxRow,columnCount:SHEETS_HEADERS[tab].length}}}});}
    else if(sheet.gridProperties.rowCount<maxRow||sheet.gridProperties.columnCount<SHEETS_HEADERS[tab].length)requests.push({updateSheetProperties:{properties:{sheetId:sheet.sheetId,gridProperties:{rowCount:Math.max(maxRow,sheet.gridProperties.rowCount),columnCount:Math.max(SHEETS_HEADERS[tab].length,sheet.gridProperties.columnCount)}},fields:'gridProperties(rowCount,columnCount)'}});
  }
  if(requests.length)await google(env,c,':batchUpdate',{requests});
  const ranges=tabs.map(tab=>`${tab}!A1:${endColumn(tab)}1`);
  const headers=await google(env,c,`/values:batchGet?${ranges.map(r=>`ranges=${encodeURIComponent(r)}`).join('&')}&valueRenderOption=FORMULA`);
  const empty:Tab[]=[];
  for(let i=0;i<tabs.length;i++){
    const tab=tabs[i]!;const values=headers.valueRanges?.[i]?.values?.[0]??[];
    if(!values.length&&initialize)empty.push(tab);
    else if(JSON.stringify(values)!==JSON.stringify(SHEETS_HEADERS[tab]))throw new SheetsError('SHEETS_HEADER_CONFLICT');
  }
  if(empty.length||(initialize&&!c.initialized)){
    // Do not adopt a populated tab with a blank first row.
    const content=await google(env,c,`/values:batchGet?${(c.initialized?empty:tabs).map(tab=>`ranges=${tab}!A2:${endColumn(tab)}`).join('&')}`);
    if(content.valueRanges?.some(r=>r.values?.length))throw new SheetsError('SHEETS_TAB_NOT_EMPTY');
  }
  if(initialize)await google(env,c,'/values:batchUpdate',{valueInputOption:'RAW',data:tabs.map(tab=>({range:`${tab}!A1:${endColumn(tab)}1`,values:[SHEETS_HEADERS[tab]]}))});
}
export function sheetValues(record:RecordRow,redact:boolean):unknown[]{
  const row=JSON.parse(record.payload) as unknown[];
  const result=Array.from({length:SHEETS_HEADERS[record.tab].length},(_,i)=>row[i]??'');
  if(redact&&row.length){
    const indices:Record<Tab,number[]>={CUSTOMERS:[2,3],MESSAGES:[5,7,11,12],CONVERSATIONS:[],AGENT_REPORTS:[]};
    for(const index of indices[record.tab])result[index]='';
  }
  // Attachments are deliberately omitted until public/non-sensitive URLs can be positively verified.
  if(record.tab==='MESSAGES')result[12]='';
  return result;
}
export async function syncSheets(env:Env,org:string,manual=false):Promise<void>{
  const token=await acquire(env,org);if(!token)return;
  let records:RecordRow[]=[];
  try{
    const c=await configuration(env,org);if((!manual&&!c.enabled)||!c.verified_at||c.next_attempt>Date.now())return;
    records=(await env.DB.prepare('SELECT * FROM sheets_outbox WHERE organization_id=? AND revision>synced_revision AND next_attempt<=? ORDER BY attempts,row_index,tab LIMIT 100').bind(org,Date.now()).all<RecordRow>()).results;
    if(!records.length)return;
    await layout(env,c,records);
    const data=records.map(r=>({range:`${r.tab}!A${r.row_index}:${endColumn(r.tab)}${r.row_index}`,values:[sheetValues(r,Boolean(c.redact))]}));
    // Refuse to overwrite a row moved by a human or another writer. Dedicated source tabs only.
    const existing=await google(env,c,`/values:batchGet?${data.map(d=>`ranges=${encodeURIComponent(d.range)}`).join('&')}&valueRenderOption=UNFORMATTED_VALUE`);
    if(existing.valueRanges?.length!==records.length)throw new SheetsError('SHEETS_RETRY_UNCONFIRMED');
    for(let i=0;i<records.length;i++){
      const record=records[i]!;const row=existing.valueRanges[i]?.values?.[0]??[];
      if(row.length&&row.some((v:unknown)=>v!=='')){
        const expected=JSON.parse(record.payload) as unknown[];
        const indices=record.tab==='AGENT_REPORTS'?[0,2,3]:record.tab==='CUSTOMERS'?[0,1,4]:[0];
        if(expected.length?indices.some(j=>row[j]!==expected[j]):row[0]!==record.logical_key)throw new SheetsError('SHEETS_ROW_CONFLICT');
      }
    }
    const lease=await env.DB.prepare('SELECT lease_token,lease_until FROM sheets_config WHERE organization_id=?').bind(org).first<{lease_token:string;lease_until:number}>();
    if(lease?.lease_token!==token||lease.lease_until<Date.now()+60000)throw new SheetsError('SHEETS_RETRY_LEASE');
    const written=await google(env,c,'/values:batchUpdate',{valueInputOption:'RAW',data});
    if(written.responses?.length!==records.length||written.responses.some(r=>r.updatedRows!==1))throw new SheetsError('SHEETS_RETRY_UNCONFIRMED');
    // Read back exact assigned ranges, including after a prior ambiguous timeout. Never append.
    const readback=await google(env,c,`/values:batchGet?${data.map(d=>`ranges=${encodeURIComponent(d.range)}`).join('&')}&valueRenderOption=UNFORMATTED_VALUE`);
    if(readback.valueRanges?.length!==records.length||records.some((r,i)=>JSON.stringify(Array.from({length:SHEETS_HEADERS[r.tab].length},(_,j)=>readback.valueRanges?.[i]?.values?.[0]?.[j]??''))!==JSON.stringify(data[i]!.values[0])))throw new SheetsError('SHEETS_RETRY_RECONCILIATION');
    await env.DB.batch(records.map(r=>env.DB.prepare('UPDATE sheets_outbox SET synced_revision=?,attempts=0,next_attempt=0,error=NULL WHERE organization_id=? AND tab=? AND logical_key=? AND revision=?').bind(r.revision,org,r.tab,r.logical_key,r.revision)));
    await env.DB.prepare('UPDATE sheets_config SET last_sync_at=?,error=NULL,next_attempt=0 WHERE organization_id=? AND lease_token=?').bind(Date.now(),org,token).run();
    await log(env,org,'SYNC_CONFIRMED',records.length);
  }catch(e){
    const code=safeCode(e);const attempts=Math.max(0,...records.map(r=>r.attempts));
    const delay=Math.max(e instanceof SheetsError?e.delay:0,Math.min(3600000,1000*2**Math.min(attempts+5,12))+Math.floor(Math.random()*1000));
    const next=Date.now()+delay;const permanent=!code.startsWith('SHEETS_RETRY_');
    await env.DB.batch([
      ...records.map(r=>env.DB.prepare('UPDATE sheets_outbox SET attempts=attempts+1,next_attempt=?,error=? WHERE organization_id=? AND tab=? AND logical_key=? AND revision=?').bind(next,code,org,r.tab,r.logical_key,r.revision)),
      env.DB.prepare('UPDATE sheets_config SET error=?,next_attempt=?,enabled=CASE WHEN ? THEN 0 ELSE enabled END,verified_at=CASE WHEN ? THEN NULL ELSE verified_at END WHERE organization_id=? AND lease_token=?').bind(code,next,permanent?1:0,permanent?1:0,org,token),
    ]);await log(env,org,code,records.length);
  }finally{await release(env,org,token);}
}
export async function processSheets(env:Env):Promise<void>{
  const configs=(await env.DB.prepare('SELECT organization_id FROM sheets_config WHERE enabled=1 AND next_attempt<=? ORDER BY COALESCE(last_sync_at,0) LIMIT 5').bind(Date.now()).all<{organization_id:string}>()).results;
  for(const c of configs)await syncSheets(env,c.organization_id);
}

export const sheets=new Hono<{Bindings:Env;Variables:{principal:Principal}}>();
sheets.use('*',async(c,next)=>{if(c.get('principal').role!=='admin')return c.json({error:'ADMIN_REQUIRED'},403);await next();});
sheets.onError((e,c)=>c.json({error:e instanceof z.ZodError||e instanceof SyntaxError?'INVALID_INPUT':safeCode(e)},400));
const body=async(request:Request):Promise<unknown>=>JSON.parse(new TextDecoder().decode(await boundedBody(request,8192)));
sheets.get('/',async c=>{
  const org=c.get('principal').org_id;
  const config=await c.env.DB.prepare('SELECT spreadsheet_id,enabled,redact,verified_at,last_sync_at,error,next_attempt FROM sheets_config WHERE organization_id=?').bind(org).first();
  const credential=await c.env.DB.prepare('SELECT client_email FROM sheets_credentials WHERE organization_id=?').bind(org).first();
  const counts=await c.env.DB.prepare('SELECT COUNT(*) AS total,COALESCE(SUM(revision>synced_revision),0) AS pending,COALESCE(SUM(revision=synced_revision),0) AS success,COALESCE(SUM(error IS NOT NULL AND revision>synced_revision),0) AS failed FROM sheets_outbox WHERE organization_id=?').bind(org).first();
  const logs=(await c.env.DB.prepare('SELECT id,code,record_count,created_at FROM sheets_logs WHERE organization_id=? ORDER BY id DESC LIMIT 50').bind(org).all()).results;
  return c.json({config,credential,counts,logs});
});
sheets.post('/configure',async c=>{
  const input=z.object({spreadsheetId:z.string().regex(/^[a-zA-Z0-9_-]{20,150}$/),redact:z.boolean()}).strict().parse(await body(c.req.raw));
  const org=c.get('principal').org_id;const current=await c.env.DB.prepare('SELECT * FROM sheets_config WHERE organization_id=?').bind(org).first<Config>();
  if(current&&current.spreadsheet_id!==input.spreadsheetId)throw new SheetsError('SHEETS_DESTINATION_IMMUTABLE');
  if(!current)await c.env.DB.prepare('INSERT OR IGNORE INTO sheets_config(organization_id,spreadsheet_id,redact) VALUES(?,?,?)').bind(org,input.spreadsheetId,input.redact?1:0).run();
  const token=await acquire(c.env,org);if(!token)throw new SheetsError('SHEETS_BUSY');
  try{const latest=await configuration(c.env,org);if(latest.error?.startsWith('SHEETS_RETRY_')&&latest.next_attempt>Date.now())throw new SheetsError('SHEETS_BACKOFF_ACTIVE');await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO sheets_config(organization_id,spreadsheet_id,redact) VALUES(?,?,?) ON CONFLICT(organization_id) DO UPDATE SET redact=excluded.redact,enabled=0,verified_at=NULL,error=NULL,next_attempt=0').bind(org,input.spreadsheetId,input.redact?1:0),
    c.env.DB.prepare('UPDATE sheets_outbox SET revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE organization_id=?').bind(org),
  ]);return c.json({saved:true});}finally{await release(c.env,org,token);}
});
sheets.post('/check',async c=>{
  z.object({}).strict().parse(await body(c.req.raw));const org=c.get('principal').org_id;await configuration(c.env,org);const token=await acquire(c.env,org);if(!token)throw new SheetsError('SHEETS_BUSY');
  try{const config=await configuration(c.env,org);if(config.error?.startsWith('SHEETS_RETRY_')&&config.next_attempt>Date.now())throw new SheetsError('SHEETS_BACKOFF_ACTIVE');await layout(c.env,config,[],true);await c.env.DB.prepare('UPDATE sheets_config SET verified_at=?,initialized=1,error=NULL,next_attempt=0 WHERE organization_id=?').bind(Date.now(),org).run();await log(c.env,org,'CONNECTION_CHECKED',0);return c.json({verified:true});}
  catch(e){
    if(!(e instanceof SheetsError&&e.message==='SHEETS_BACKOFF_ACTIVE')){
      const code=safeCode(e);const transient=code.startsWith('SHEETS_RETRY_');
      await c.env.DB.prepare('UPDATE sheets_config SET verified_at=NULL,enabled=0,error=?,next_attempt=? WHERE organization_id=?').bind(code,transient?Date.now()+Math.max(60000,e instanceof SheetsError?e.delay:0):0,org).run();
      await log(c.env,org,code,0);
    }throw e;
  }
  finally{await release(c.env,org,token);}
});
sheets.post('/enabled',async c=>{
  const input=z.object({enabled:z.boolean()}).strict().parse(await body(c.req.raw));const org=c.get('principal').org_id;const config=await configuration(c.env,org);
  if(input.enabled&&!config.verified_at)throw new SheetsError('SHEETS_CHECK_REQUIRED');
  await c.env.DB.prepare('UPDATE sheets_config SET enabled=? WHERE organization_id=?').bind(input.enabled?1:0,org).run();return c.json({saved:true});
});
sheets.post('/sync',async c=>{z.object({}).strict().parse(await body(c.req.raw));const org=c.get('principal').org_id;const config=await configuration(c.env,org);if(!config.verified_at)throw new SheetsError('SHEETS_CHECK_REQUIRED');c.executionCtx.waitUntil(syncSheets(c.env,org,true));return c.json({scheduled:true});});
sheets.post('/retry',async c=>{
  z.object({}).strict().parse(await body(c.req.raw));const org=c.get('principal').org_id;const config=await configuration(c.env,org);
  if(!config.verified_at)throw new SheetsError('SHEETS_CHECK_REQUIRED');
  if(config.next_attempt>Date.now())throw new SheetsError('SHEETS_BACKOFF_ACTIVE');
  await c.env.DB.prepare('UPDATE sheets_outbox SET next_attempt=0 WHERE organization_id=? AND error IS NOT NULL').bind(org).run();
  c.executionCtx.waitUntil(syncSheets(c.env,org,true));return c.json({scheduled:true});
});