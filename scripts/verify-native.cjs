const { spawnSync } = require('node:child_process');
const executable = require('electron');
// better-sqlite3 13 ships a Node-API prebuild. Validate under Electron's Node,
// not the host Node ABI; fail installation/packaging if the binary cannot load.
const script = `const D=require('better-sqlite3');const d=new D(':memory:');console.log(JSON.stringify({electron:process.versions.electron,abi:process.versions.modules,napi:process.versions.napi,arch:process.arch,integrity:d.pragma('quick_check',{simple:true})}));d.close();`;
const result = spawnSync(executable, ['-e', script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error) console.error(result.error);
if (result.status !== 0) process.exit(1);