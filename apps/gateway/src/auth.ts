import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Principal } from './types';
import { boundedBody, digest, randomSecret } from './security';
import { hashPassword, verifyPassword } from './password';

type Bindings = { Bindings: Env; Variables: { principal: Principal } };
export const auth = new Hono<Bindings>();
export const employees = new Hono<Bindings>();
const roles = z.enum(['super_admin','admin','manager','agent','viewer']);
const email = z.email().max(254).transform(value => value.trim().toLowerCase());
const password = z.string().min(15).max(128);
const device = z.uuid();
async function body(request: Request): Promise<unknown> { return JSON.parse(new TextDecoder().decode(await boundedBody(request, 8192))); }
export async function authenticate(env: Env, token: string): Promise<Principal | null> {
  const hash = await digest(token); const now = Date.now();
  const session = await env.DB.prepare(`SELECT s.organization_id AS org_id,s.user_id,m.role,s.device_id,s.id AS session_id
    FROM employee_sessions s JOIN memberships m ON m.organization_id=s.organization_id AND m.user_id=s.user_id
    WHERE s.access_hash=? AND s.revoked=0 AND s.access_expires>? AND s.expires_at>? AND m.active=1`).bind(hash,now,now).first<Principal>();
  if (session) return session;
  // Legacy operator credentials remain expiring and tenant-bound. No offline bypass.
  return env.DB.prepare(`SELECT g.org_id,g.user_id,m.role FROM gateway_credentials g JOIN memberships m ON m.organization_id=g.org_id AND m.user_id=g.user_id
    WHERE g.token_hash=? AND g.revoked=0 AND g.expires_at>? AND m.active=1`).bind(hash,now).first<Principal>();
}
async function limit(env: Env, key: string, maximum: number): Promise<boolean> {
  const window = Math.floor(Date.now()/900000);
  const row = await env.DB.prepare(`INSERT INTO auth_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET
    attempts=CASE WHEN auth_limits.window=excluded.window THEN auth_limits.attempts+1 ELSE 1 END,window=excluded.window RETURNING attempts`).bind(await digest(key),window).first<{attempts:number}>();
  return Boolean(row && row.attempts <= maximum);
}
function log(env: Env, p: Principal, action: string, target: string): D1PreparedStatement {
  return env.DB.prepare("INSERT INTO inbox_audit(organization_id,actor_id,action,target_id,detail,created_at) VALUES(?,?,?,?,'',?)").bind(p.org_id,p.user_id,action,target,Date.now());
}
auth.post('/login', async c => {
  if (!await limit(c.env,`ip:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`,40)) return c.json({error:'RATE_LIMITED'},429);
  const input = z.object({email,password:z.string().min(1).max(128),deviceId:device}).strict().parse(await body(c.req.raw));
  if (!await limit(c.env,`email:${input.email}`,10)) return c.json({error:'RATE_LIMITED'},429);
  const row = await c.env.DB.prepare(`SELECT a.*,m.role FROM employee_auth a JOIN memberships m ON m.organization_id=a.organization_id AND m.user_id=a.user_id WHERE a.email=? AND m.active=1`).bind(input.email).first<{organization_id:string;user_id:string;password_hash:string;role:Principal['role']}>();
  // Same KDF for nonexistent/disabled identities; no account existence oracle in errors.
  const dummy='scrypt:16384:8:5:'+'0'.repeat(32)+':'+'0'.repeat(64);
  const valid = await verifyPassword(input.password,row?.password_hash ?? dummy);
  if (!row || !valid) return c.json({error:'INVALID_CREDENTIALS'},401);
  const accessToken=randomSecret(), refreshToken=randomSecret(), now=Date.now();
  const principal:Principal={org_id:row.organization_id,user_id:row.user_id,role:row.role};
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO employee_sessions VALUES(?,?,?,?,?,?,?,?,0,?)').bind(crypto.randomUUID(),row.organization_id,row.user_id,input.deviceId,await digest(accessToken),await digest(refreshToken),now+900000,now+7*86400000,now),
    log(c.env,principal,'LOGIN',input.deviceId),
  ]);
  return c.json({accessToken,refreshToken,accessExpires:now+900000,expiresAt:now+7*86400000,principal});
});
auth.post('/refresh', async c => {
  if (!await limit(c.env,`refresh:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`,120)) return c.json({error:'RATE_LIMITED'},429);
  const input=z.object({refreshToken:z.string().regex(/^[a-f0-9]{64}$/),deviceId:device}).strict().parse(await body(c.req.raw));
  const now=Date.now(),accessToken=randomSecret(),refreshToken=randomSecret();
  // Single-use rotation is an atomic CAS, including current membership check.
  const row=await c.env.DB.prepare(`UPDATE employee_sessions SET access_hash=?,refresh_hash=?,access_expires=?
    WHERE refresh_hash=? AND device_id=? AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=employee_sessions.organization_id AND m.user_id=employee_sessions.user_id AND m.active=1)
    RETURNING organization_id,user_id,expires_at`).bind(await digest(accessToken),await digest(refreshToken),now+900000,await digest(input.refreshToken),input.deviceId,now).first<{organization_id:string;user_id:string;expires_at:number}>();
  if(!row)return c.json({error:'UNAUTHORIZED'},401);
  const member=await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id=? AND user_id=? AND active=1').bind(row.organization_id,row.user_id).first<{role:Principal['role']}>();
  if(!member)return c.json({error:'UNAUTHORIZED'},401);
  return c.json({accessToken,refreshToken,accessExpires:now+900000,expiresAt:row.expires_at,principal:{org_id:row.organization_id,user_id:row.user_id,role:member.role}});
});
employees.post('/logout',async c=>{
  const p=c.get('principal');
  if(p.session_id)await c.env.DB.prepare('UPDATE employee_sessions SET revoked=1 WHERE id=? AND organization_id=?').bind(p.session_id,p.org_id).run();
  return c.json({saved:true});
});
employees.post('/employees',async c=>{
  const p=c.get('principal');if(!['super_admin','admin'].includes(p.role))return c.json({error:'FORBIDDEN'},403);
  const input=z.object({userId:z.string().min(1).max(80),name:z.string().trim().min(1).max(100),email,password,role:roles}).strict().parse(await body(c.req.raw));
  if(input.role==='super_admin' && p.role!=='super_admin')return c.json({error:'FORBIDDEN'},403);
  const existing=await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id=? AND user_id=?').bind(p.org_id,input.userId).first<{role:string}>();
  if(existing?.role==='super_admin'&&p.role!=='super_admin')return c.json({error:'FORBIDDEN'},403);
  if(input.userId===p.user_id)return c.json({error:'CANNOT_EDIT_SELF'},409);
  const hash=await hashPassword(input.password);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users VALUES(?,?,?) ON CONFLICT(organization_id,id) DO UPDATE SET name=excluded.name').bind(p.org_id,input.userId,input.name),
    c.env.DB.prepare('INSERT INTO memberships VALUES(?,?,?,1) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role').bind(p.org_id,input.userId,input.role),
    c.env.DB.prepare('INSERT INTO employee_auth VALUES(?,?,?,?,?) ON CONFLICT(organization_id,user_id) DO UPDATE SET email=excluded.email,password_hash=excluded.password_hash,updated_at=excluded.updated_at').bind(input.email,p.org_id,input.userId,hash,Date.now()),
    c.env.DB.prepare('UPDATE employee_sessions SET revoked=1 WHERE organization_id=? AND user_id=?').bind(p.org_id,input.userId),
    log(c.env,p,'EMPLOYEE_CREDENTIAL_SET',input.userId),
  ]);
  return c.json({saved:true});
});
employees.post('/employees/remove',async c=>{
  const p=c.get('principal');if(!['super_admin','admin'].includes(p.role))return c.json({error:'FORBIDDEN'},403);
  const {userId}=z.object({userId:z.string().min(1).max(80)}).strict().parse(await body(c.req.raw));
  if(userId===p.user_id)return c.json({error:'CANNOT_EDIT_SELF'},409);
  const member=await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id=? AND user_id=?').bind(p.org_id,userId).first<{role:string}>();
  if(member?.role==='super_admin'&&p.role!=='super_admin')return c.json({error:'FORBIDDEN'},403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM memberships WHERE organization_id=? AND user_id=?').bind(p.org_id,userId),
    c.env.DB.prepare('DELETE FROM employee_auth WHERE organization_id=? AND user_id=?').bind(p.org_id,userId),
    c.env.DB.prepare('DELETE FROM inbox_grants WHERE organization_id=? AND user_id=?').bind(p.org_id,userId),
    log(c.env,p,'EMPLOYEE_REMOVED',userId),
  ]);
  // Keep historical users/agent attribution, not login ability.
  return c.json({saved:true});
});