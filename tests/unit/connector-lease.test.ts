import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({request:vi.fn(),files:new Map<string,string>()}));
vi.mock('electron',()=>({app:{getPath:()=>'/fixture'}}));
vi.mock('node:fs',()=>({readFileSync:(path:string)=>{if(!mock.files.has(path))throw new Error('ENOENT');return mock.files.get(path);},writeFileSync:(path:string,value:string)=>mock.files.set(path,value)}));
vi.mock('../../apps/desktop/electron/auth/session',()=>({gatewaySession:()=>({deviceId:'device',request:mock.request})}));
import { ConnectorLease } from '../../apps/desktop/electron/auth/connector';
beforeEach(()=>{vi.useFakeTimers();mock.files.clear();mock.request.mockReset();});
afterEach(()=>vi.useRealTimers());
it('does not heartbeat persisted inactive fences and stops renewing after lease loss',async()=>{
 mock.files.set('/fixture/connector-fences.json',JSON.stringify([['inactive',{fence:'old',expires_at:Date.now()+90000}]]));
 const lease=new ConnectorLease();const stop=vi.fn(async()=>{});lease.watch(stop);
 await vi.advanceTimersByTimeAsync(20000);expect(mock.request).not.toHaveBeenCalled();
 mock.request.mockResolvedValueOnce({fence:'new',expires_at:Date.now()+90000});await lease.ensure('active');
 mock.request.mockRejectedValueOnce(new Error('CONNECTOR_BUSY'));
 await vi.advanceTimersByTimeAsync(20000);expect(stop).toHaveBeenCalledWith('active');
 const calls=mock.request.mock.calls.length;await vi.advanceTimersByTimeAsync(40000);expect(mock.request).toHaveBeenCalledTimes(calls);lease.close();
});
it('deduplicates acquisitions and cannot reactivate a suspended lease from an in-flight response',async()=>{
 let finish!:(value:{fence:string;expires_at:number})=>void;
 mock.request.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const lease=new ConnectorLease();const a=lease.ensure('channel'),b=lease.ensure('channel');
 expect(mock.request).toHaveBeenCalledTimes(1);lease.suspend();
 finish({fence:'late',expires_at:Date.now()+90000});
 expect((await Promise.allSettled([a,b])).every(result=>result.status==='rejected')).toBe(true);
 expect(()=>lease.headers('channel')).toThrow('CONNECTOR_LEASE_REQUIRED');lease.close();
});