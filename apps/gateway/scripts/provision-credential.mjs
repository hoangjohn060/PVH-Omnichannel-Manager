import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const [org, user, role, days, target] = args;
if (args.length !== 5 || !org || !user || !/^[a-zA-Z0-9_-]{1,80}$/.test(org) || !/^[a-zA-Z0-9_-]{1,80}$/.test(user) || !['admin', 'manager', 'agent', 'viewer'].includes(role) || !/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 90 || !['--local', '--remote'].includes(target)) {
  console.error('Usage: node scripts/provision-credential.mjs <org-id> <verified-user-id> <admin|manager|agent|viewer> <1-90 days> <--local|--remote>'); process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const secret = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(secret).digest('hex');
const sql = `INSERT INTO gateway_credentials(token_hash,org_id,user_id,role,expires_at) VALUES('${hash}','${org}','${user}','${role}',${Date.now() + Number(days) * 86400000});`;
mkdirSync(resolve(root, '.wrangler'), { recursive: true });
const file = resolve(root, '.wrangler', `credential-${randomBytes(8).toString('hex')}.sql`);
writeFileSync(file, sql);
try {
  const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'DB', target, '--file', file], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = 1;
  else console.log(`Credential for verified employee ${user} in ${org}. Shown once; do not share or commit.\nPVH_GATEWAY_CREDENTIAL=${secret}\nRevoke by token_hash=${hash}`);
} finally { unlinkSync(file); }