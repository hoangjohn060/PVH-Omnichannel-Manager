/// <reference types="@cloudflare/workers-types" />
import {it,expect} from 'vitest';
import {unstable_dev,getPlatformProxy} from 'wrangler';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import type {Env} from '../../apps/gateway/src/types';
import {digest} from '../../apps/gateway/src/security';

it('actual workerd HTTP executes native scrypt, employee login, refresh and server revoke',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'pvh-auth-workerd-'));const config=resolve('apps/gateway/wrangler.jsonc');
 // Wrangler dev adds the versioned state directory; platform proxy expects its full path.
 const proxy=await getPlatformProxy<Env>({configPath:config,persist:{path:join(directory,'v3')}});
 let worker:Awaited<ReturnType<typeof unstable_dev>>|undefined;
 try{
  for(const file of ['0001_facebook.sql','0002_inbox.sql','0003_sheets.sql','0004_multiagent.sql']){
   const sql=readFileSync(resolve(`apps/gateway/migrations/${file}`),'utf8').replace(/--[^\n]*/g,'');
   const statements=sql.split(/(CREATE TRIGGER[\s\S]*?END;)/).flatMap(part=>part.trim().startsWith('CREATE TRIGGER')?[part]:part.split(';')).map(s=>s.trim()).filter(Boolean);
   await proxy.env.DB.batch(statements.map(s=>proxy.env.DB.prepare(s)));
  }
  const token='6'.repeat(64);
  await proxy.env.DB.prepare('INSERT INTO gateway_credentials VALUES(?,?,?,?,?,0)').bind(await digest(token),'runtime-org','admin','admin',Date.now()+600000).run();
  await proxy.dispose();
  worker=await unstable_dev(resolve('apps/gateway/src/index.ts'),{config,persist:true,persistTo:directory,port:0,inspectorPort:0,experimental:{disableExperimentalWarning:true},vars:{PUBLIC_ORIGIN:'https://gateway.example'}});
  const post=(path:string,body:unknown,access=token)=>worker!.fetch(path,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const password='workerd fixture password 123';const deviceId=crypto.randomUUID();
  let response=await post('/api/auth/employees',{userId:'agent',name:'Fixture',email:'runtime@example.com',password,role:'agent'});expect(response.status,await response.clone().text()).toBe(200);
  response=await post('/auth/login',{email:'runtime@example.com',password,deviceId});expect(response.status,await response.clone().text()).toBe(200);
  const session=await response.json() as {accessToken:string;refreshToken:string};
  expect((await post('/auth/login',{email:'runtime@example.com',password:'wrong',deviceId})).status).toBe(401);
  response=await post('/auth/refresh',{refreshToken:session.refreshToken,deviceId});expect(response.status,await response.clone().text()).toBe(200);
  const next=await response.json() as {accessToken:string};
  expect((await post('/auth/refresh',{refreshToken:session.refreshToken,deviceId})).status).toBe(401);
  expect((await post('/api/inbox/members',{userId:'agent',name:'Fixture',role:'agent',active:false})).status).toBe(200);
  expect((await worker.fetch('/api/inbox/session',{headers:{Authorization:`Bearer ${next.accessToken}`}})).status).toBe(401);
 }finally{await worker?.stop();await proxy.dispose().catch(()=>{});rmSync(directory,{recursive:true,force:true});}
},60000);