import { gatewayOrigin } from '../facebook/adapter';
import type { DatabaseClient } from '../database/client';
import type { ZaloSupervisor } from '../zalo/supervisor';
import type { ZaloMessage } from '@pvh/shared/types';
import type { InboxSession } from '@pvh/shared/types/inbox';
import { gatewaySession } from '../auth/session';
import { connectorLease } from '../auth/connector';

export class InboxBridge {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private readonly origin = gatewayOrigin(process.env.PVH_GATEWAY_URL);
  constructor(private database: DatabaseClient, private zalo: ZaloSupervisor) {}
  async request<T>(path: string, body?: unknown, headers:Record<string,string>={}): Promise<T> {
    if(path.startsWith('changes?')){
      const query=new URLSearchParams(path.split('?')[1]);
      const principal=gatewaySession().status().principal;
      if(!principal)throw new Error('GATEWAY_AUTH_REQUIRED');
      const key=`${principal.org_id}:${principal.user_id}:${query.get('channel')}`;
      if(!query.has('after'))query.set('after',String(await this.database.call<number>('sync:get',{key})));
      const data=await gatewaySession().request<{cursor:number;items:unknown[];more:boolean}>(`inbox/changes?${query}`);
      await this.database.call('sync:set',{key,cursor:data.cursor});
      return data as T;
    }
    return gatewaySession().request<T>(`inbox/${path}`,body,headers);
  }
  start(): void { if (this.origin) void this.tick(); }
  close(): void { this.stopped = true; clearTimeout(this.timer); }
  private async tick(): Promise<void> {
    let delay = 15000;
    try {
      const session = await this.request<InboxSession>('session');
      const local = await this.zalo.snapshot();
      const channels = session.channels.filter(ch => ch.platform === 'zalo' && ch.connector_user_id === session.principal.user_id && local.accounts.some(a => a.id === ch.id));
      for (const ch of channels) {
        await connectorLease().ensure(ch.id);
        const headers=connectorLease().headers(ch.id);
        const pending = await this.database.call<{id:number;payload:string}[]>('inbox:outbox', { accountId:ch.id });
        for (const item of pending) {
          const m = JSON.parse(item.payload) as ZaloMessage;
          await this.request('connector/ingest', { channelId:m.accountId,messageId:m.messageId,threadId:m.threadId,threadType:m.threadType,senderId:m.senderId,senderName:m.senderName,isSelf:m.isSelf,text:m.text,timestamp:m.timestamp,attachment:m.attachment,status:m.status },headers);
          await this.database.call('inbox:ack', {id:item.id,payload:item.payload});
        }
        if (!local.accounts.some(a => a.id === ch.id && a.state === 'CONNECTED')) continue;
        const { job } = await this.request<{job:null|{id:string;attempts:number;external_id:string;thread_type:0|1;content:string}}>('connector/claim',{channelId:ch.id},headers);
        if (!job || this.stopped) continue;
        // Preserve a durable connector journal key for every attempt. Never blindly retry UNKNOWN.
        const requestId = job.attempts === 1 ? job.id : await this.database.call<string>('inbox:attempt', {jobId:job.id,attempt:job.attempts});
        let result: {jobId:string;status:'SENT'|'FAILED'|'UNKNOWN';messageId:string|null;error?:string};
        try {
          const sent = await this.zalo.send({accountId:ch.id,threadId:job.external_id,threadType:job.thread_type,text:job.content,requestId});
          result = {jobId:job.id,status:'SENT',messageId:sent.messageId};
        } catch {
          const journal = await this.database.call<{status:string;messageId:string|null}|null>('inbox:send-result',{requestId});
          result = journal?.status === 'SENT' && journal.messageId ? {jobId:job.id,status:'SENT',messageId:journal.messageId} : {jobId:job.id,status:journal?.status === 'FAILED' ? 'FAILED' : 'UNKNOWN',messageId:null,error:'CONNECTOR_SEND_FAILED'};
        }
        await this.database.call('inbox:result-save', {...result,channelId:ch.id,headers});
      }
      const results = await this.database.call<{job_id:string;payload:string}[]>('inbox:results',{});
      for (const result of results) {
        const {channelId:_channelId,headers,...payload}=JSON.parse(result.payload) as {channelId:string;headers:Record<string,string>;jobId:string};
        await this.request('connector/result',payload,headers??{});
        await this.database.call('inbox:result-ack',{jobId:result.job_id});
      }
    } catch { delay = 60000; /* Keep persisted outbox/results. Never expose connector payloads or credentials. */ }
    finally { if (!this.stopped) this.timer = setTimeout(() => { void this.tick(); }, delay+Math.floor(Math.random()*3000)); }
  }
}