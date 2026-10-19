const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
module.exports = async function beforePack(context) {
  const result = spawnSync(process.execPath, [join(__dirname, 'verify-native.cjs')], { cwd: context.appDir, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error('Electron SQLite native probe failed; packaging stopped');
};