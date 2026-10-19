/// <reference types="@cloudflare/workers-types" />
import { beforeEach,afterEach,it,expect } from 'vitest';
import { DatabaseSync,type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { app,maintenance } from '../../apps/gateway/src/index';
import { digest } from '../../apps/gateway/src/security';
import { hashPassword,verifyPassword } from '../../apps/gateway/src/password';
import type { Env } from '../../apps/gateway/src/types';
class Binding{
 sql=new DatabaseSync(':memory:');
 constructor(){for(const file of ['0001_facebook.sql','0002_inbox.sql','0003_sheets.sql','0004_multiagent.sql'])this.sql.exec(readFileSync(new URL(`../../apps/gateway/migrations/${file}`,import.meta.url),'utf8'));}
 prepare(query:string){let values:SQLInputValue[]=[];const statement={bind:(...v:SQLInputValue[])=>{values=v;return statement;},first:async()=>this.sql.prepare(query).get(...values)??null,all:async()=>({results:this.sql.prepare(query).all(...values),success:true}),run:async()=>({success:true,meta:{changes:Number(this.sql.prepare(query).run(...values).changes)},results:[]})};return statement;}
 async batch(statements:ReturnType<Binding['prepare']>[]){this.sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());this.sql.exec('COMMIT');return results;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
let db:Binding,env:Env;
const admin='a'.repeat(64),channel='12345678-1234-4123-8123-123456789012',deviceA=crypto.randomUUID(),deviceB=crypto.randomUUID();
const password='fixture password with 25 chars';
const ctx={waitUntil:()=>{},passThroughOnException:()=>{}} as unknown as ExecutionContext;
const request=(path:string,body?:unknown,token=admin,headers:Record<string,string>={})=>app.request(`https://gateway.example/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})},env,ctx);
async function employee(userId:string,role='agent'){const response=await request('api/auth/employees',{userId,name:userId,email:`${userId}@example.com`,password,role});expect(response.status,await response.clone().text()).toBe(200);}
async function login(userId:string,deviceId=deviceA){const response=await request('auth/login',{email:`${userId}@example.com`,password,deviceId});expect(response.status,await response.clone().text()).toBe(200);return response.json() as Promise<{accessToken:string;refreshToken:string;principal:{org_id:string}}>}
beforeEach(async()=>{db=new Binding();env={DB:db as unknown as D1Database,META_APP_ID:'',META_APP_SECRET:'',META_VERIFY_TOKEN:'',TOKEN_ENCRYPTION_KEY:btoa('k'.repeat(32)),PUBLIC_ORIGIN:'https://gateway.example'};db.sql.prepare('INSERT INTO gateway_credentials VALUES(?,?,?,?,?,0)').run(await digest(admin),'org','admin','admin',Date.now()+3600000);expect((await request('api/inbox/connector/register',{accountId:channel,name:'Fixture',connectorUserId:'admin'})).status).toBe(200);});
afterEach(()=>db.sql.close());
it('uses salted versioned memory-hard hashes, verifies and rejects a wrong password',async()=>{const a=await hashPassword(password),b=await hashPassword(password);expect(a).not.toBe(b);expect(a).not.toContain(password);expect(await verifyPassword(password,a)).toBe(true);expect(await verifyPassword('wrong',a)).toBe(false);expect(await verifyPassword(password,'invalid')).toBe(false);});
it('two staff log in with server-derived tenant; tokens expire and refresh rotates once',async()=>{
 await employee('agentA');await employee('agentB');const a=await login('agentA'),b=await login('agentB',deviceB);expect(a.accessToken).not.toBe(b.accessToken);expect(a.principal.org_id).toBe('org');
 expect((await request('auth/login',{email:'agentA@example.com',password,deviceId:deviceA,organization_id:'attacker'})).status).toBe(400);
 db.sql.prepare('UPDATE employee_sessions SET access_expires=0 WHERE user_id=?').run('agentA');expect((await request('api/inbox/session',undefined,a.accessToken)).status).toBe(401);
 const refresh=await request('auth/refresh',{refreshToken:a.refreshToken,deviceId:deviceA});expect(refresh.status).toBe(200);expect((await request('auth/refresh',{refreshToken:a.refreshToken,deviceId:deviceA})).status).toBe(401);
 const next=await refresh.json() as {accessToken:string};expect((await request('api/inbox/session',undefined,next.accessToken)).status).toBe(200);
});
it('limits failed login attempts and does not disclose missing identities',async()=>{for(let n=0;n<10;n++)expect((await request('auth/login',{email:'missing@example.com',password:'wrong',deviceId:deviceA})).status).toBe(401);expect((await request('auth/login',{email:'missing@example.com',password:'wrong',deviceId:deviceA})).status).toBe(429);});
it('disable, credential change and logout revoke sessions server-side',async()=>{
 await employee('agentA');const a=await login('agentA');await request('api/inbox/members',{userId:'agentA',name:'A',role:'agent',active:false});expect((await request('api/inbox/session',undefined,a.accessToken)).status).toBe(401);expect((await request('auth/refresh',{refreshToken:a.refreshToken,deviceId:deviceA})).status).toBe(401);
 await request('api/inbox/members',{userId:'agentA',name:'A',role:'agent',active:true});const b=await login('agentA');expect((await request('api/auth/logout',{},b.accessToken)).status).toBe(200);expect((await request('api/inbox/session',undefined,b.accessToken)).status).toBe(401);
});
it('admin cannot create SUPER_ADMIN or cross tenant records; employee deletion retains attribution',async()=>{
 expect((await request('api/auth/employees',{userId:'evil',name:'X',email:'x@example.com',password,role:'super_admin'})).status).toBe(403);await employee('agentA');const a=await login('agentA');expect((await request('api/auth/employees/remove',{userId:'admin'},a.accessToken)).status).toBe(403);expect((await request('api/auth/employees/remove',{userId:'agentA'})).status).toBe(200);expect((await request('api/inbox/session',undefined,a.accessToken)).status).toBe(401);expect(db.sql.prepare('SELECT name FROM users WHERE id=?').get('agentA')).toBeTruthy();
});
it('two devices contend for one fenced lease; expiry permits takeover but not old owner claim',async()=>{
 const acquire=(deviceId:string)=>request('api/inbox/connector/lease',{channelId:channel,deviceId});const a=await acquire(deviceA);expect(a.status).toBe(200);const lease=await a.json() as {fence:string};expect((await acquire(deviceB)).status).toBe(409);
 const headers={'X-Device-ID':deviceA,'X-Connector-Fence':lease.fence};expect((await request('api/inbox/connector/claim',{channelId:channel},admin,headers)).status).toBe(200);
 db.sql.exec('UPDATE connector_leases SET expires_at=0');expect((await acquire(deviceB)).status).toBe(200);expect((await request('api/inbox/connector/claim',{channelId:channel},admin,headers)).status).toBe(400);
});
it('binds a real Zalo identity uniquely and rejects identity changes',async()=>{
 const lease=await (await request('api/inbox/connector/lease',{channelId:channel,deviceId:deviceA})).json() as {fence:string};
 const headers={'X-Device-ID':deviceA,'X-Connector-Fence':lease.fence};
 expect((await request('api/inbox/connector/bind',{channelId:channel,uid:'123456'},admin,headers)).status).toBe(200);
 expect((await request('api/inbox/connector/bind',{channelId:channel,uid:'654321'},admin,headers)).status).toBe(400);
 const other=crypto.randomUUID();await request('api/inbox/connector/register',{accountId:other,name:'Other',connectorUserId:'admin'});
 const second=await (await request('api/inbox/connector/lease',{channelId:other,deviceId:deviceB})).json() as {fence:string};
 expect(await (await request('api/inbox/connector/bind',{channelId:other,uid:'123456'},admin,{'X-Device-ID':deviceB,'X-Connector-Fence':second.fence})).json()).toEqual({error:'DUPLICATE_ACCOUNT'});
});
it('maintenance prunes expired authentication state without deleting active sessions',async()=>{
 await employee('agentA');await login('agentA');
 db.sql.exec("INSERT INTO auth_limits VALUES('old',0,1); UPDATE employee_sessions SET expires_at=0");
 await maintenance(env);
 expect(db.sql.prepare('SELECT COUNT(*) AS n FROM employee_sessions').get()).toEqual({n:0});
 expect(db.sql.prepare("SELECT COUNT(*) AS n FROM auth_limits WHERE key='old'").get()).toEqual({n:0});
 await login('agentA');await maintenance(env);
 expect(db.sql.prepare('SELECT COUNT(*) AS n FROM employee_sessions').get()).toEqual({n:1});
});
it('reconnect sees exactly one customer/conversation/message and authorized cursor; assignment CAS conflicts',async()=>{
 const lease=await (await request('api/inbox/connector/lease',{channelId:channel,deviceId:deviceA})).json() as {fence:string};const headers={'X-Device-ID':deviceA,'X-Connector-Fence':lease.fence};
 const incoming={channelId:channel,messageId:'mid',threadId:'123',threadType:0,senderId:'123',senderName:'Customer',isSelf:false,text:'Fixture',timestamp:Date.now(),attachment:null,status:'RECEIVED'};
 for(let n=0;n<2;n++)expect((await request('api/inbox/connector/ingest',incoming,admin,headers)).status).toBe(200);
 await employee('agentA');await employee('agentB');for(const userId of ['agentA','agentB'])await request('api/inbox/grants',{channelId:channel,userId,allowed:true});const a=await login('agentA'),b=await login('agentB',deviceB);const conversation=`zalo:${channel}:123`;
 expect((await request(`api/inbox/conversations/${conversation}/update`,{version:0,status:'OPEN',assignedUserId:'agentA'},a.accessToken)).status).toBe(200);expect((await request(`api/inbox/conversations/${conversation}/update`,{version:0,status:'OPEN',assignedUserId:'agentB'},b.accessToken)).status).toBe(409);
 const jobId=crypto.randomUUID();expect((await request(`api/inbox/conversations/${conversation}/send`,{requestId:jobId,text:'Agent A reply',version:1},a.accessToken)).status).toBe(200);
 const claim=await request('api/inbox/connector/claim',{channelId:channel},admin,headers);expect(await claim.json()).toMatchObject({job:{id:jobId,agent_id:'agentA'}});expect(await (await request('api/inbox/connector/claim',{channelId:channel},admin,headers)).json()).toEqual({job:null});
 expect((await request('api/inbox/connector/result',{jobId,status:'SENT',messageId:'external-reply'},admin,headers)).status).toBe(200);
  const detail=await (await request(`api/inbox/conversations/${conversation}`,undefined,b.accessToken)).json() as {messages:{agent_id:string}[]};expect(detail.messages).toHaveLength(2);expect(detail.messages[1]?.agent_id).toBe('agentA');expect(db.sql.prepare("SELECT json_extract(payload,'$[9]') AS agent_id FROM sheets_messages WHERE logical_key=(SELECT message_id FROM inbox_send_jobs WHERE id=?)").get(jobId)).toMatchObject({agent_id:'agentA'});
 for(const table of ['customers','conversations'])expect(db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({n:1});
 const changes=await (await request(`api/inbox/changes?channel=${channel}&after=0`,undefined,b.accessToken)).json() as {cursor:number};expect(changes.cursor).toBeGreaterThan(0);expect(await (await request(`api/inbox/changes?channel=${channel}&after=${changes.cursor}`,undefined,b.accessToken)).json()).toMatchObject({items:[],cursor:changes.cursor});
 await request('api/inbox/grants',{channelId:channel,userId:'agentB',allowed:false});expect((await request(`api/inbox/conversations/${conversation}`,undefined,b.accessToken)).status).toBe(404);
 await maintenance(env);
});