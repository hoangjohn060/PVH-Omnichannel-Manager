// Run under Electron, not system Node, to verify the actual desktop runtime.
const { app } = require('electron');
app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    console.log(JSON.stringify({ electron: process.versions.electron, abi: process.versions.modules, arch: process.arch, sqlite: db.prepare('select sqlite_version() as version').get(), integrity: db.pragma('quick_check', { simple: true }) }));
    db.close(); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});