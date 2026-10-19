/// <reference types="@cloudflare/workers-types" />
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { app, maintenance } from '../../apps/gateway/src/index';
import { digest } from '../../apps/gateway/src/security';
import { parseIpc } from '../../packages/shared/schemas';
import type { Env } from '../../apps/gateway/src/types';
import type { InboxDetail, InboxConversation } from '../../packages/shared/types/inbox';

// Fixture-only D1 shape. All migrations, HTTP authorization and SQL execute unchanged.
class Binding {
  sql=new DatabaseSync(':memory:');
  constructor(){for(const file of ['0001_facebook.sql','0002_inbox.sql','0003_sheets.sql','0004_multiagent.sql'])this.sql.exec(readFileSync(new URL(`../../apps/gateway/migrations/${file}`,import.meta.url),'utf8'));}
  prepare(query:string){
    let values:SQLInputValue[]=[];
    const statement={bind:(...input:SQLInputValue[])=>{values=input;return statement;},first:async()=>this.sql.prepare(query).get(...values)??null,all:async()=>({results:this.sql.prepare(query).all(...values),success:true,meta:{changes:0}}),run:async()=>({success:true,meta:{changes:Number(this.sql.prepare(query).run(...values).changes)},results:[]})};return statement;
  }
  async batch(statements:ReturnType<Binding['prepare']>[]){this.sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());this.sql.exec('COMMIT');return results;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
let db:Binding;let env:Env;
const tokens={admin:'a'.repeat(64),agent:'b'.repeat(64),agent2:'c'.repeat(64),viewer:'d'.repeat(64),other:'e'.repeat(64)};
const ch='11111111-1111-4111-8111-111111111111';const fb='22222222-2222-4222-8222-222222222222';const zaloConversation=`zalo:${ch}:123`;
const ctx={waitUntil:vi.fn(),passThroughOnException:vi.fn()} as unknown as ExecutionContext;
async function api(path:string,body?:unknown,role:keyof typeof tokens='admin'){
  return app.request(`https://gateway.example/api/inbox/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json','X-Device-ID':'11111111-1111-4111-8111-111111111119','X-Connector-Fence':'11111111-1111-4111-8111-111111111118'},...(body===undefined?{}:{body:JSON.stringify(body)})},env,ctx);
}
async function read<T>(path:string,role:keyof typeof tokens='admin'):Promise<T>{const response=await api(path,undefined,role);expect(response.status,await response.clone().text()).toBe(200);return response.json() as Promise<T>;}
const inbound=(overrides:Record<string,unknown>={})=>({channelId:ch,messageId:'mid1',threadId:'123',threadType:0,senderId:'123',senderName:'KhÃ¡ch Viá»‡t ðŸ‡»ðŸ‡³',isSelf:false,text:'Xin chÃ o Zalo ðŸ‘‹',timestamp:Date.now()-1000,attachment:null,status:'RECEIVED',...overrides});
async function ingest(overrides:Record<string,unknown>={}){const response=await api('connector/ingest',inbound(overrides));expect(response.status,await response.clone().text()).toBe(200);}
async function send(role:keyof typeof tokens='agent',version=0,requestId=crypto.randomUUID(),conversationId=zaloConversation){return api(`conversations/${conversationId}/send`,{requestId,text:'ChÃ o báº¡n ðŸ‡»ðŸ‡³',version},role);}
beforeEach(async()=>{
  db=new Binding();env={DB:db as unknown as D1Database,META_APP_ID:'999',META_APP_SECRET:'fixture',META_VERIFY_TOKEN:'fixture',TOKEN_ENCRYPTION_KEY:btoa('k'.repeat(32)),PUBLIC_ORIGIN:'https://gateway.example'};
  for(const [user,token] of Object.entries(tokens))db.sql.prepare('INSERT INTO gateway_credentials VALUES(?,?,?,?,?,0)').run(await digest(token),user==='other'?'org2':'org1',user,user==='other'?'admin':user==='agent2'?'agent':user,Date.now()+3600000);
  expect((await api('connector/register',{accountId:ch,name:'Zalo bÃ¡n hÃ ng',connectorUserId:'admin'})).status).toBe(200);
  db.sql.prepare('INSERT INTO connector_leases VALUES(?,?,?,?,?,?)').run('org1',ch,'11111111-1111-4111-8111-111111111119','admin','11111111-1111-4111-8111-111111111118',Date.now()+90000);
  db.sql.prepare("INSERT INTO fb_pages(id,org_id,page_id,name,status,permissions,owner_id) VALUES(?,'org1','456','Fanpage','CONNECTED','[]','admin')").run(fb);
  for(const user of ['agent','agent2','viewer'])for(const channel of [ch,fb])db.sql.prepare('INSERT INTO inbox_grants VALUES(?,?,?)').run('org1',channel,user);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.sql.close();});
it('ingests a Zalo fixture durably, deduplicates external id and keeps original content',async()=>{
  await ingest();await ingest({text:'KhÃ´ng ghi Ä‘Ã¨ báº£n gá»‘c'});
  const detail=await read<InboxDetail>(`conversations/${zaloConversation}`,'agent');
  expect(detail.messages).toHaveLength(1);expect(detail.messages[0]).toMatchObject({content:'Xin chÃ o Zalo ðŸ‘‹',direction:'incoming',agent_id:null,attribution_status:'unknown',sender_origin:'external'});
  expect((await read<{items:InboxConversation[]}>('conversations','agent')).items[0]).toMatchObject({unread:1,platform:'zalo',channel_name:'Zalo bÃ¡n hÃ ng'});
});
it('projects Facebook inbound, native echo and monotonic receipt with unknown external agent',async()=>{
  db.sql.prepare("INSERT INTO fb_messages VALUES(?,'fb-mid','789','incoming','Xin chÃ o Facebook','[]',?,NULL,'RECEIVED')").run(fb,Date.now()-1000);
  db.sql.prepare("INSERT INTO fb_messages VALUES(?,'echo','789','outgoing','Native reply','[]',?,NULL,'ACCEPTED')").run(fb,Date.now());
  db.sql.prepare("UPDATE fb_messages SET status='READ' WHERE message_id='echo'").run();
  const detail=await read<InboxDetail>(`conversations/facebook:${fb}:789`,'agent');
  expect(detail.messages).toHaveLength(2);expect(detail.messages[1]).toMatchObject({agent_id:null,attribution_status:'unknown',sender_origin:'facebook_native',send_status:'READ'});
});
it('sends Zalo via a durable job with authenticated identity and reconciles early echo',async()=>{
  await ingest();const requestId=crypto.randomUUID();const response=await send('agent',0,requestId);expect(response.status,await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({status:'PENDING'});
  const before=await read<InboxDetail>(`conversations/${zaloConversation}`);expect(before.messages.at(-1)).toMatchObject({send_status:'PENDING',agent_id:'agent',agent_name:'agent',attribution_status:'verified',sender_origin:'desktop_agent'});
  const claim=await api('connector/claim',{channelId:ch});expect(await claim.json()).toMatchObject({job:{id:requestId,agent_id:'agent',attempts:1,content:'ChÃ o báº¡n ðŸ‡»ðŸ‡³'}});
  await ingest({messageId:'sent-id',isSelf:true,text:'ChÃ o báº¡n ðŸ‡»ðŸ‡³',timestamp:Date.now()});
  expect((await api('connector/result',{jobId:requestId,status:'SENT',messageId:'sent-id'})).status).toBe(200);
  expect((await api('connector/result',{jobId:requestId,status:'SENT',messageId:'sent-id'})).status).toBe(200);
  const after=await read<InboxDetail>(`conversations/${zaloConversation}`);expect(after.messages).toHaveLength(2);expect(after.messages.at(-1)).toMatchObject({agent_id:'agent',send_status:'SENT',external_message_id:'sent-id'});
  expect(db.sql.prepare("SELECT actor_id FROM inbox_audit WHERE action='SEND_QUEUED'").get()).toMatchObject({actor_id:'agent'});
});
it('prevents spoofed agent id and viewer send, including old Facebook API',async()=>{
  await ingest();expect((await send('viewer')).status).toBe(403);
  expect((await api(`conversations/${zaloConversation}/send`,{requestId:crypto.randomUUID(),text:'fake',version:0,agent_id:'admin'},'agent')).status).toBe(400);
  const legacy=await app.request(`https://gateway.example/api/facebook/pages/${fb}/send`,{method:'POST',headers:{Authorization:`Bearer ${tokens.viewer}`,'Content-Type':'application/json','X-Device-ID':'11111111-1111-4111-8111-111111111119','X-Connector-Fence':'11111111-1111-4111-8111-111111111118'},body:JSON.stringify({requestId:crypto.randomUUID(),psid:'789',text:'fake'})},env,ctx);expect(legacy.status).toBe(403);
});
it('enforces inbox ACL, tenant isolation and immediate membership revocation',async()=>{
  await ingest();db.sql.prepare('DELETE FROM inbox_grants WHERE user_id=?').run('agent');
  expect((await api(`conversations/${zaloConversation}`,undefined,'agent')).status).toBe(404);
  expect((await read<{items:unknown[]}>('conversations','agent')).items).toEqual([]);
  expect((await api(`conversations/${zaloConversation}`,undefined,'other')).status).toBe(404);
  expect((await api('connector/ingest',inbound(),'other')).status).toBe(404);
  db.sql.exec("UPDATE memberships SET active=0 WHERE user_id='agent2'");expect((await api('session',undefined,'agent2')).status).toBe(401);
});
it('serializes two agents on a conversation version and only transmits one client request',async()=>{
  await ingest();const requestId=crypto.randomUUID();expect((await send('agent',0,requestId)).status).toBe(200);
  expect((await send('agent2',0)).status).toBe(409);expect((await send('agent',0,requestId)).status).toBe(200);
  expect((await send('agent2',1,requestId)).status).toBe(409);
  expect(db.sql.prepare('SELECT COUNT(*) AS n FROM inbox_send_jobs').get()).toEqual({n:1});
});
it('moves assignment using CAS, refuses viewer assignment and audits actor',async()=>{
  await ingest();const path=`conversations/${zaloConversation}/update`;
  expect((await api(path,{version:0,status:'PENDING',assignedUserId:'agent2'},'agent')).status).toBe(200);
  expect((await api(path,{version:0,status:'RESOLVED',assignedUserId:'agent'},'agent2')).status).toBe(409);
  expect((await api(path,{version:1,status:'OPEN',assignedUserId:'viewer'},'agent')).status).toBe(400);
  expect((await read<InboxDetail>(`conversations/${zaloConversation}`)).conversation).toMatchObject({assigned_user_id:'agent2',status:'PENDING',version:1});
  expect(db.sql.prepare('SELECT COUNT(*) AS n FROM conversation_assignments').get()).toEqual({n:1});
});
it('does not label a failed send as sent and only allows manual definitive-failure retry',async()=>{
  await ingest();const requestId=crypto.randomUUID();await send('agent',0,requestId);await api('connector/claim',{channelId:ch});
  await api('connector/result',{jobId:requestId,status:'FAILED',messageId:null,error:'SDK_REJECTED'});
  expect((await read<InboxDetail>(`conversations/${zaloConversation}`)).messages.at(-1)?.send_status).toBe('FAILED');
  expect((await api(`jobs/${requestId}/retry`,{},'viewer')).status).toBe(403);
  expect((await api(`jobs/${requestId}/retry`,{},'agent')).status).toBe(200);await api('connector/claim',{channelId:ch});
  await api('connector/result',{jobId:requestId,status:'UNKNOWN',messageId:null,error:'TIMEOUT'});
  expect((await api(`jobs/${requestId}/retry`,{},'agent')).status).toBe(400);
  expect((await send('agent',1)).status).toBe(409);
});
it('keeps draft private to each agent, notes internal, tags versioned and content searchable',async()=>{
  await ingest();const path=`conversations/${zaloConversation}`;
  expect((await api(`${path}/draft`,{content:'NhÃ¡p riÃªng'},'agent')).status).toBe(200);
  expect((await read<InboxDetail>(path,'agent2')).draft).toBe('');expect((await read<InboxDetail>(path,'agent')).draft).toBe('NhÃ¡p riÃªng');
  await api(`${path}/notes`,{content:'Ná»™i bá»™'},'agent');await api(`${path}/customer`,{version:0,tags:['VIP','VIP'],careNotes:'Gá»i láº¡i'},'agent');
  const detail=await read<InboxDetail>(path);expect(detail.notes).toHaveLength(1);expect(detail.messages).toHaveLength(1);expect(detail.customer).toMatchObject({tags:'["VIP"]',care_notes:'Gá»i láº¡i',version:1});
  expect((await api(`${path}/customer`,{version:0,tags:[],careNotes:''},'agent2')).status).toBe(409);
  expect((await read<{items:unknown[]}>('conversations?q=Zalo','agent')).items).toHaveLength(1);
});
it('keeps same-named people separate and paginates without duplicate ids',async()=>{
  for(let index=0;index<53;index++)await ingest({messageId:`m${index}`,threadId:String(1000+index),senderId:String(1000+index),timestamp:Date.now()-10000});
  const page=await read<{items:InboxConversation[];next:string}>('conversations','agent');expect(page.items).toHaveLength(50);
  const rest=await read<{items:InboxConversation[];next:null}>(`conversations?${new URLSearchParams({before:page.next})}`,'agent');expect(rest.items).toHaveLength(3);
  expect(new Set([...page.items,...rest.items].map(x=>x.customer_id)).size).toBe(53);
});
it('uses per-channel change cursors and bounded timeline history',async()=>{
  for(let index=0;index<53;index++)await ingest({messageId:`m${index}`,timestamp:Date.now()-100000+index});
  const first=await read<InboxDetail>(`conversations/${zaloConversation}`);expect(first.messages).toHaveLength(50);expect(first.next).not.toBeNull();
  const older=await read<InboxDetail>(`conversations/${zaloConversation}?${new URLSearchParams({before:first.next!})}`);expect(older.messages).toHaveLength(3);
  const changes=await read<{items:unknown[];cursor:number}>(`changes?channel=${ch}&after=0`);expect(changes.items.length).toBeGreaterThan(0);
  expect((await read<{items:unknown[]}>(`changes?channel=${ch}&after=${changes.cursor}`)).items).toEqual([]);
});
it('blocks connector forgery by ordinary agents and renderer connector paths',async()=>{
  expect((await api('connector/ingest',inbound(),'agent')).status).toBe(403);
  expect(()=>parseIpc('inbox:request',{path:'connector/claim',body:{channelId:ch}})).toThrow();
  expect(()=>parseIpc('inbox:request',{path:'conversations/../connector/claim'})).toThrow();
  expect(()=>parseIpc('inbox:request',{path:'conversations/%2e%2e/connector/claim'})).toThrow();
  expect(()=>parseIpc('inbox:request',{path:'conversations/%2E%2E%2Fconnector%2Fclaim'})).toThrow();
  expect(()=>parseIpc('inbox:request',{path:'https://evil.test'})).toThrow();
});
it('revalidates sender membership before a connector dispatches queued work',async()=>{
  await ingest();await send('agent');
  db.sql.exec("UPDATE memberships SET role='viewer' WHERE user_id='agent'");
  const claim=await api('connector/claim',{channelId:ch});expect(await claim.json()).toEqual({job:null});
  expect(db.sql.prepare('SELECT status,error FROM inbox_send_jobs').get()).toMatchObject({status:'FAILED',error:'SENDER_ACCESS_REVOKED'});
});
it('admin manages roles/grants, viewer cannot mutate and membership is authoritative over stale credential role',async()=>{
  expect((await api('members',{userId:'agent',name:'A',role:'viewer',active:true},'agent')).status).toBe(403);
  expect((await api('members',{userId:'agent',name:'NhÃ¢n viÃªn A',role:'viewer',active:true})).status).toBe(200);
  expect((await api('session',undefined,'agent')).status).toBe(401);
  expect((await api('grants',{channelId:ch,userId:'viewer',allowed:false})).status).toBe(200);
  expect((await read<{channels:unknown[]}>('session','viewer')).channels).toHaveLength(1);
});
it('recovers interrupted sends to UNKNOWN, not sent, with no automatic duplicate retry',async()=>{
  await ingest();const requestId=crypto.randomUUID();await send('agent',0,requestId);await api('connector/claim',{channelId:ch});
  db.sql.prepare('UPDATE inbox_send_jobs SET updated_at=?').run(Date.now()-300000);await maintenance(env);
  expect((await read<InboxDetail>(`conversations/${zaloConversation}`)).messages.at(-1)?.send_status).toBe('UNKNOWN');
  expect((await api(`jobs/${requestId}/retry`,{},'agent')).status).toBe(400);
});
it('Facebook agent reply uses real adapter result, persisted pending and confirmed server-side identity',async()=>{
  const { Graph, REQUIRED_PERMISSIONS, WEBHOOK_FIELDS }=await import('../../apps/gateway/src/graph');
  const { encrypt }=await import('../../apps/gateway/src/security');
  db.sql.prepare('UPDATE fb_pages SET token=? WHERE id=?').run(await encrypt(env.TOKEN_ENCRYPTION_KEY,'fixture-token','page:org1:456'),fb);
  db.sql.prepare('INSERT INTO fb_threads VALUES(?,?,?,?)').run(fb,'789',`facebook:456:789`,Date.now()-1000);
  db.sql.prepare("INSERT INTO fb_messages VALUES(?,'incoming','789','incoming','Hello','[]',?,NULL,'RECEIVED')").run(fb,Date.now()-1000);
  vi.spyOn(Graph.prototype,'inspect').mockResolvedValue([...REQUIRED_PERMISSIONS]);
  vi.spyOn(Graph.prototype,'call').mockImplementation(async(path:string)=>{
    if(path==='me')return {id:'456'};
    if(path.endsWith('/subscribed_apps'))return {data:[{id:'999',subscribed_fields:[...WEBHOOK_FIELDS]}]};
    expect(db.sql.prepare("SELECT send_status,agent_id FROM messages WHERE direction='outgoing'").get()).toMatchObject({send_status:'PENDING',agent_id:'agent'});
    return {message_id:'real-fixture-result',recipient_id:'789'};
  });
  const requestId=crypto.randomUUID();const response=await send('agent',0,requestId,`facebook:${fb}:789`);expect(response.status,await response.clone().text()).toBe(200);expect(await response.json()).toMatchObject({status:'ACCEPTED'});
  const detail=await read<InboxDetail>(`conversations/facebook:${fb}:789`);expect(detail.messages).toHaveLength(2);expect(detail.messages.at(-1)).toMatchObject({agent_id:'agent',attribution_status:'verified',send_status:'ACCEPTED',external_message_id:'real-fixture-result'});
});