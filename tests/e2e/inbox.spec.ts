import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
test.use({trace:'off',screenshot:'off',video:'off'});
async function launch(configured=false){
  const env:Record<string,string>={};for(const [key,value] of Object.entries(process.env))if(value!==undefined&&!['ELECTRON_RUN_AS_NODE','PVH_GATEWAY_URL','PVH_GATEWAY_CREDENTIAL'].includes(key))env[key]=value;
  env.PVH_USER_DATA=mkdtempSync(join(tmpdir(),'pvh-inbox-fixture-'));
  if(configured){env.PVH_GATEWAY_URL='https://fixture.invalid';env.PVH_GATEWAY_CREDENTIAL='a'.repeat(64);}
  const application=await electron.launch({...process.env.PVH_PACKAGED?{executablePath:resolve('dist/win-unpacked/PVH Omnichannel Manager.exe')}:{args:[resolve('apps/desktop')]},env,timeout:45000});
  const page=application.windows().find(p=>p.url().startsWith('file:'))??await application.waitForEvent('window',{predicate:p=>!p.url().startsWith('data:')});
  await expect(page.getByTestId('workspace')).toBeVisible();return{application,page};
}
test('unified inbox truthful blocked state, three columns and secure connector IPC allowlist',async()=>{
  const {application,page}=await launch();try{
    await page.getByRole('navigation').getByRole('button',{name:'Hộp thư chung',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Hộp thư hợp nhất',exact:true})).toBeVisible();
    await expect(page.getByRole('status')).toContainText('BLOCKED');
    await expect(page.getByTestId('unified-inbox')).toBeVisible();
    expect(await page.evaluate(()=>window.desktop.inbox.request({path:'connector/claim',body:{}}))).toMatchObject({ok:false});
    expect(await page.evaluate(()=>window.desktop.zalo.send({accountId:'11111111-1111-4111-8111-111111111111',threadId:'123',threadType:0,text:'not sent',requestId:crypto.randomUUID()}))).toMatchObject({ok:false});
    await page.getByRole('navigation').getByRole('button',{name:'Nhân viên',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Nhân viên và quyền inbox',exact:true})).toBeVisible();
    await expect(page.getByRole('status')).toContainText('BLOCKED');
  }finally{await application.close();}
});
test('fixture-only unified UI renders both platforms, verified vs unknown attribution, draft, notes and viewer restrictions',async()=>{
  const {application,page}=await launch(true);try{
    // Test-process-only transport simulator. No fixtures or production message fabrication in app code.
    await application.evaluate(()=>{
      const now=Date.now();let draft='Nháp đã lưu';let role='agent';
      const rows=['zalo','facebook'].map((platform,index)=>({id:`fixture-${platform}`,channel_id:`channel-${platform}`,customer_id:`customer-${platform}`,external_id:String(123+index),name:`Khách ${platform}`,avatar:null,platform,channel_name:`Inbox ${platform}`,preview:`Xin chào ${platform} 🇻🇳`,updated_at:now,created_at:now-60000,status:'OPEN',assigned_user_id:'agent',agent_name:'Nhân viên A',version:0,unread:1}));
      const notes:{id:string;actor_id:string;content:string;created_at:number}[]=[];
      globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
        const url=new URL(String(input));if(url.origin!=='https://fixture.invalid')throw new Error('FIXTURE_NETWORK_DENIED');
        if(url.pathname==='/auth/login')return Response.json({accessToken:'a'.repeat(64),refreshToken:'b'.repeat(64),accessExpires:now+900000,expiresAt:now+86400000,principal:{org_id:'fixture-org',user_id:'agent',role:'agent'}});
        const path=url.pathname.replace('/api/inbox/','');const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:{};
        if(path==='session')return Response.json({principal:{org_id:'fixture-org',user_id:'agent',role},channels:rows.map(r=>({id:r.channel_id,platform:r.platform,name:r.channel_name})),members:[{user_id:'agent',name:'Nhân viên A',role:'agent',active:1}]});
        if(path==='conversations')return Response.json({items:rows.filter(r=>!url.searchParams.get('platform')||r.platform===url.searchParams.get('platform')),next:null});
        if(path==='changes')return Response.json({items:[],cursor:0,more:false});
        if(path==='fixture-viewer'){role='viewer';return Response.json({saved:true});}
        const row=rows.find(r=>path.includes(r.id));
        if(path.endsWith('/jobs'))return Response.json({jobs:[]});
        if(path.endsWith('/draft')){draft=String(body.content);return Response.json({saved:true});}
        if(path.endsWith('/read'))return Response.json({saved:true});
        if(path.endsWith('/notes')){notes.push({id:'fixture-note',actor_id:'agent',content:String(body.content),created_at:now});return Response.json({saved:true});}
        if(row)return Response.json({conversation:row,customer:{id:row.customer_id,name:row.name,tags:'["VIP"]',care_notes:'Khách fixture',created_at:now-60000,updated_at:now,version:0},messages:[{id:'fixture-incoming',direction:'incoming',content:row.preview,sender_name:row.name,source_created_at:now-1000,received_at:now-1000,send_status:'RECEIVED',attachments:'[]',sender_origin:'external',attribution_status:'unknown',agent_id:null},{id:'fixture-native',direction:'outgoing',content:'Native fixture',sender_name:'Page',agent_name:null,agent_id:null,source_created_at:now,received_at:now,send_status:'SENT',attachments:'[]',sender_origin:`${row.platform}_native`,attribution_status:'unknown'}],next:null,draft,notes,history:[{id:row.id,status:'OPEN',created_at:now-60000}],stats:{incoming:1,outgoing:1,first_response_ms:null}});
        return Response.json({error:'FIXTURE_UNHANDLED'},{status:404});
      }) as typeof fetch;
    });
    expect(await page.evaluate(()=>window.desktop.auth.login({email:'fixture@example.com',password:'fixture password only'}))).toMatchObject({ok:true});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.getByRole('navigation').getByRole('button',{name:'Hộp thư chung',exact:true}).click();
    await page.getByRole('button',{name:/Khách zalo/}).click();
    await expect(page.getByLabel('Timeline tin nhắn')).toContainText('Xin chào zalo 🇻🇳');
    await expect(page.getByLabel('Timeline tin nhắn')).toContainText('Người gửi chưa xác định');
    await expect(page.getByLabel('Nội dung trả lời')).toHaveValue('Nháp đã lưu');
    await page.getByLabel('Nội dung trả lời').fill('Draft 🇻🇳');await expect(page.getByText('Draft đã lưu trên gateway',{exact:false})).toBeVisible();
    await page.getByLabel('Ghi chú nội bộ',{exact:true}).fill('Ghi chú fixture');await page.getByRole('button',{name:'Lưu ghi chú',exact:true}).click();
    await expect(page.getByText('Ghi chú nội bộ (1)',{exact:true})).toBeVisible();
    await page.getByLabel('Lọc kênh',{exact:true}).selectOption('facebook');await page.getByRole('button',{name:/Khách facebook/}).click();
    await expect(page.getByLabel('Timeline tin nhắn')).toContainText('Xin chào facebook 🇻🇳');
    await expect(page.getByLabel('Thông tin khách hàng')).toContainText('124');
    await application.evaluate(async()=>{await fetch('https://fixture.invalid/api/inbox/fixture-viewer');});
    // Remount to force a new authenticated session rather than waiting the normal refresh interval.
    await page.reload();await expect(page.getByRole('heading',{name:'Hộp thư hợp nhất',exact:true})).toBeVisible();
    await page.getByRole('button',{name:/Khách zalo/}).click();
    await expect(page.getByText('VIEWER · Chỉ xem, không được gửi hoặc chỉnh sửa.',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Gửi',exact:true})).toHaveCount(0);
    expect(errors).toEqual([]);
  }finally{await application.close();}
});