import { app } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { encryptSecret, decryptSecret } from '../security/secrets';
import { httpsOrigin, readGateway, writeGateway } from './configuration';

interface Tokens { accessToken:string; refreshToken:string; accessExpires:number; expiresAt:number; principal:{org_id:string;user_id:string;role:string} }
export class GatewaySession {
  private tokens?: Tokens;
  private refreshing?: Promise<void>;
  private generation=0;
  private readonly file=join(app.getPath('userData'),'employee-session.bin');
  readonly deviceId: string;
  private originValue: string | null;
  get origin(): string | null { return this.originValue; }
  constructor(){
    this.originValue=readGateway(app.getPath('userData')) ?? httpsOrigin(process.env.PVH_GATEWAY_URL);
    const deviceFile=join(app.getPath('userData'),'device-id');
    try{const id=readFileSync(deviceFile,'utf8');if(!/^[a-f0-9-]{36}$/.test(id))throw new Error();this.deviceId=id;}catch{this.deviceId=randomUUID();writeFileSync(deviceFile,this.deviceId);}
    try{this.tokens=JSON.parse(decryptSecret(readFileSync(this.file))) as Tokens;}catch{ /* Require online login; never use a cached password. */ }
  }
  status(){return {configured:Boolean(this.origin),origin:this.origin,authenticated:Boolean(this.tokens),principal:this.tokens?.principal??null};}
  configure(origin:string){
    if(this.tokens)throw new Error('LOGOUT_BEFORE_GATEWAY_CHANGE');
    writeGateway(app.getPath('userData'),origin);
    this.clear();
    this.originValue=origin;
    return this.status();
  }
  private save(tokens: Tokens): void { const temporary=this.file+'.tmp';writeFileSync(temporary,encryptSecret(JSON.stringify(tokens)));renameSync(temporary,this.file);this.tokens=tokens; }
  private async auth<T>(path:string,body:unknown):Promise<T>{
    if(!this.origin)throw new Error('GATEWAY_CONFIGURATION_REQUIRED');
    const response=await fetch(`${this.origin}/auth/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(45000)});
    const data=await response.json() as T&{error?:string};
    if(!response.ok)throw new Error(data.error&&/^[A-Z0-9_]+$/.test(data.error)?data.error:'GATEWAY_REQUEST_FAILED');return data;
  }
  async login(email:string,password:string){const generation=++this.generation;const tokens=await this.auth<Tokens>('login',{email,password,deviceId:this.deviceId});if(generation!==this.generation)throw new Error('GATEWAY_AUTH_REQUIRED');this.save(tokens);return this.status();}
  async credential():Promise<string>{
    if(!this.tokens)throw new Error('GATEWAY_AUTH_REQUIRED');
    if(this.tokens.accessExpires<Date.now()+60000){
      const generation=this.generation;
      this.refreshing??=this.auth<Tokens>('refresh',{refreshToken:this.tokens.refreshToken,deviceId:this.deviceId}).then(tokens=>{if(generation!==this.generation)throw new Error('GATEWAY_AUTH_REQUIRED');this.save(tokens);}).catch(error=>{if(generation===this.generation&&error instanceof Error&&error.message==='UNAUTHORIZED')this.clear();throw error;}).finally(()=>{if(generation===this.generation)this.refreshing=undefined;});
      await this.refreshing;
    }
    if(!this.tokens)throw new Error('GATEWAY_AUTH_REQUIRED');return this.tokens.accessToken;
  }
  clear():void{this.generation++;this.refreshing=undefined;this.tokens=undefined;rmSync(this.file,{force:true});}
  async logout(){try{await this.request('auth/logout',{});}finally{this.clear();}return this.status();}
  async request<T>(path:string,body?:unknown,headers:Record<string,string>={}):Promise<T>{
    if(!this.origin)throw new Error('GATEWAY_CONFIGURATION_REQUIRED');
    const token=await this.credential();
    const response=await fetch(`${this.origin}/api/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(45000)});
    const data=await response.json() as T&{error?:string};
    if(response.status===401&&this.tokens?.accessToken===token)this.clear();
    if(!response.ok)throw new Error(data.error&&/^[A-Z0-9_]+$/.test(data.error)?data.error:'GATEWAY_REQUEST_FAILED');return data;
  }
}
let instance:GatewaySession|undefined;
export const gatewaySession=():GatewaySession=>instance??=new GatewaySession();