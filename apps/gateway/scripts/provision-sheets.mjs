// Run only on an admin-controlled workstation. Never copy this key into the EXE.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, randomBytes, createPrivateKey } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const [org,file,target]=process.argv.slice(2);
let directory;
try {
  if(!org||!/^[a-zA-Z0-9_-]{1,80}$/.test(org)||!file||!['--local','--remote'].includes(target)||process.argv.length!==5)throw new Error('INPUT');
  const encryptionKey=Buffer.from(process.env.TOKEN_ENCRYPTION_KEY??'','base64');
  if(encryptionKey.length!==32)throw new Error('KEY');
  const service=JSON.parse(readFileSync(resolve(file),'utf8'));
  if(service.type!=='service_account'||!/^[-a-zA-Z0-9_.]+@[-a-zA-Z0-9.]+\.iam\.gserviceaccount\.com$/.test(service.client_email))throw new Error('SERVICE_ACCOUNT');
  if(createPrivateKey(service.private_key).asymmetricKeyType!=='rsa')throw new Error('RSA_REQUIRED');
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);cipher.setAAD(Buffer.from(`sheets:${org}`));
  const data=Buffer.concat([cipher.update(service.private_key,'utf8'),cipher.final(),cipher.getAuthTag()]);
  const ciphertext=`v1.${iv.toString('base64')}.${data.toString('base64')}`;
  const sql=`INSERT INTO sheets_credentials(organization_id,client_email,encrypted_key) VALUES('${org}','${service.client_email}','${ciphertext}') ON CONFLICT(organization_id) DO UPDATE SET client_email=excluded.client_email,encrypted_key=excluded.encrypted_key,encrypted_token=NULL,token_expires_at=0; UPDATE sheets_config SET enabled=0,verified_at=NULL,error=NULL,next_attempt=0 WHERE organization_id='${org}';`;
  directory=mkdtempSync(join(tmpdir(),'pvh-sheets-'));const path=join(directory,'credential.sql');writeFileSync(path,sql,{mode:0o600});
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const require=createRequire(import.meta.url);const wrangler=join(dirname(require.resolve('wrangler/package.json')),'bin','wrangler.js');
  const result=spawnSync(process.execPath,[wrangler,'d1','execute','DB',target,'--file',path],{cwd:root,stdio:'pipe',windowsHide:true});
  if(result.status!==0)throw new Error('D1');
  console.log('Service Account encrypted in D1. Share the test spreadsheet with its email, then check access in Settings > Google Sheets. Sync remains disabled.');
}catch{console.error('SHEETS_PROVISION_FAILED. Usage: node scripts/provision-sheets.mjs <org-id> <absolute-service-account-json> <--local|--remote>; TOKEN_ENCRYPTION_KEY must match the gateway AES key. No credential values are printed.');process.exitCode=1;}
finally{if(directory)rmSync(directory,{recursive:true,force:true});}