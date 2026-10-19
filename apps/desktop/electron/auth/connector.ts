import { gatewaySession } from './session';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

// Main-only lease capability; fence is not exposed to renderer. Persisted for crash result reconciliation.
export class ConnectorLease {
  private leases=new Map<string,{fence:string;expires_at:number}>();
  private pending=new Map<string,Promise<void>>();
  private active=new Set<string>();
  private generation=0;
  private timer?:NodeJS.Timeout;
  private file=join(app.getPath('userData'),'connector-fences.json');
  constructor(){try{this.leases=new Map(JSON.parse(readFileSync(this.file,'utf8')) as [string,{fence:string;expires_at:number}][]);}catch{/* first launch */}}
  async ensure(channelId:string):Promise<void>{
    let task=this.pending.get(channelId);
    if(!task){task=this.acquire(channelId).finally(()=>this.pending.delete(channelId));this.pending.set(channelId,task);}
    await task;
  }
  private async acquire(channelId:string):Promise<void>{
    const generation=this.generation;
    const session=gatewaySession();const current=this.leases.get(channelId);
    const value=await session.request<{fence:string;expires_at:number}>('inbox/connector/lease',{channelId,deviceId:session.deviceId,...(current?{fence:current.fence}:{})});
    if(generation!==this.generation)throw new Error('CONNECTOR_LEASE_LOST');
    this.active.add(channelId);
    // Use conservative local deadline (clock skew must not extend a server lease).
    this.leases.set(channelId,{...value,expires_at:Math.min(value.expires_at,Date.now()+80000)});
    writeFileSync(this.file,JSON.stringify([...this.leases]));
  }
  async register(channelId:string,name:string):Promise<void>{
    const session=gatewaySession();const status=session.status();
    if(!status.principal)throw new Error('GATEWAY_AUTH_REQUIRED');
    const snapshot=await session.request<{channels:{id:string}[]}>('inbox/session');
    if(!snapshot.channels.some(ch=>ch.id===channelId))await session.request('inbox/connector/register',{accountId:channelId,name,connectorUserId:status.principal.user_id});
  }
  async bind(channelId:string,uid:string):Promise<void>{await this.ensure(channelId);await gatewaySession().request('inbox/connector/bind',{channelId,uid},this.headers(channelId));}
  headers(channelId:string):Record<string,string>{const lease=this.leases.get(channelId);if(!lease)throw new Error('CONNECTOR_LEASE_REQUIRED');return{'X-Device-ID':gatewaySession().deviceId,'X-Connector-Fence':lease.fence};}
  watch(stop:(channelId:string)=>Promise<unknown>):void{
    clearInterval(this.timer);
    this.timer=setInterval(()=>{for(const channelId of this.active)void this.ensure(channelId).catch(async()=>{this.active.delete(channelId);await stop(channelId).catch(()=>{});});},20000);
  }
  suspend():void{this.generation++;this.active.clear();this.pending.clear();}
  close():void{clearInterval(this.timer);this.suspend();}
}
let instance:ConnectorLease|undefined;
export const connectorLease=():ConnectorLease=>instance??=new ConnectorLease();