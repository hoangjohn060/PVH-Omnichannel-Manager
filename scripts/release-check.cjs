// Read-only inspection of source and final packaged resources. Never prints matched secret values.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json')));
const archive = path.join(dist, 'win-unpacked/resources/app.asar');
const files = asar.listPackage(archive).map(value => value.replaceAll('\\', '/'));
const findings = [];
const checks = {
  privateKey: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=]{32}/,
  awsAccessKey: /\bAKIA[A-Z0-9]{16}\b/,
  googleApiKey: /\bAIza[0-9A-Za-z_-]{35}\b/,
  githubToken: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  assignedCredential: /(?:client_secret|access_token|refresh_token|api_key)\s*[:=]\s*['"][A-Za-z0-9_\/-]{28,}['"]/i,
};
function scan(filename, text, scope) {
  for (const [rule, pattern] of Object.entries(checks)) if (pattern.test(text)) findings.push({ scope, filename, rule });
}
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules','out','dist','release','.git','.wrangler'].includes(item.name)) continue;
    const filename=path.join(directory,item.name);
    if(item.isDirectory())walk(filename);
    else if(/\.(?:tsx?|m?[jc]s|json|ya?ml|toml|env|sql)$/.test(item.name)&&!item.name.includes('lock'))scan(path.relative(root,filename),fs.readFileSync(filename,'utf8'),'source');
  }
}
for (const directory of ['apps','packages','scripts']) walk(path.join(root,directory));
const own=files.filter(file=>/^\/out\/.*\.(?:js|html|css)$/.test(file));
const developmentPaths=[];
for (const file of own) {
  const text=asar.extractFile(archive,path.normalize(file.slice(1))).toString('utf8');
  scan(file,text,'packaged');
  if(/[A-Za-z]:[\\/]cvvui[\\/]|localhost:5173|127\.0\.0\.1:5173/.test(text))developmentPaths.push(file);
}
const required=['/out/main/index.js','/out/main/database-worker.js','/out/main/zalo-worker.js','/out/preload/index.js','/out/renderer/index.html','/assets/icon.png'];
const missing=required.filter(file=>!files.includes(file));
const native=path.join(dist,'win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node');
const executable=path.join(dist,'PVH-Omnichannel-Manager-Setup-x64.exe');
const report={timestamp:new Date().toISOString(),version:pkg.version,versions:{electron:pkg.devDependencies.electron,builder:pkg.devDependencies['electron-builder'],sqlite:pkg.dependencies['better-sqlite3'],node:process.version},secretScan:{status:findings.length?'FAILED':'PASSED',method:'High-confidence regex, own source and packaged first-party JS/CSS/HTML only; not a proof of absence; dependencies and historical commits excluded.',findings},assets:{status:missing.length?'FAILED':'PASSED',required,missing},developmentPaths:{status:developmentPaths.length?'FAILED':'PASSED',findings:developmentPaths},native:{status:fs.existsSync(native)?'PASSED':'FAILED',filename:path.relative(dist,native)},archiveEntries:files.length,installer:{filename:path.basename(executable),bytes:fs.statSync(executable).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex').toUpperCase()}};
fs.writeFileSync(path.join(dist,'release-inspection.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(findings.length||missing.length||developmentPaths.length||!fs.existsSync(native))process.exitCode=1;