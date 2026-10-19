import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const [org,user,email,target]=process.argv.slice(2);
const password=process.env.PVH_BOOTSTRAP_PASSWORD;
delete process.env.PVH_BOOTSTRAP_PASSWORD;
if(process.argv.length!==6||![org,user].every(value=>/^[a-zA-Z0-9_-]{1,80}$/.test(value??''))||!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['--local','--remote'].includes(target)||!password||password.length<15||password.length>128){
 console.error('Usage: set PVH_BOOTSTRAP_PASSWORD (15-128 characters), then node scripts/bootstrap-employee.mjs <org> <verified-user> <email> <--local|--remote>');process.exit(1);
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const salt=randomBytes(16).toString('hex');
const hash=`scrypt:16384:8:5:${salt}:${scryptSync(password,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024}).toString('hex')}`;
const quote=value=>`'${value.replaceAll("'","''")}'`;
// INSERT only: an accidental rerun must not reset an existing employee or escalate membership.
const sql=`INSERT INTO organizations VALUES(${quote(org)},${quote(org)});
INSERT INTO users VALUES(${quote(org)},${quote(user)},${quote(user)});
INSERT INTO memberships VALUES(${quote(org)},${quote(user)},'super_admin',1);
INSERT INTO employee_auth VALUES(${quote(email.toLowerCase())},${quote(org)},${quote(user)},${quote(hash)},${Date.now()});`;
mkdirSync(resolve(root,'.wrangler'),{recursive:true});
const file=resolve(root,'.wrangler',`bootstrap-${randomBytes(8).toString('hex')}.sql`);
writeFileSync(file,sql);
try{
 const require=createRequire(import.meta.url);
 const result=spawnSync(process.execPath,[resolve(dirname(require.resolve('wrangler')),'../bin/wrangler.js'),'d1','execute','DB',target,'--file',file],{cwd:root,stdio:'inherit'});
 if(result.status!==0)process.exitCode=1;
 else console.log('Initial SUPER_ADMIN created. Log in through the Windows employee form; no bearer credential is needed.');
}finally{unlinkSync(file);}