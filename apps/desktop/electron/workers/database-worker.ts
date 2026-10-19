import { parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from '../database/migrations';
import { settingsSchema, settingsPatchSchema } from '@pvh/shared/schemas';
import type { Settings, AuditEvent } from '@pvh/shared/types';
import { zaloDatabaseOperation } from '../database/zalo-repository';
import { tuneDatabase } from '../database/tuning';

const port = parentPort;
if (!port) throw new Error('Database worker requires a parent');
const directory = (workerData as { directory: string }).directory;
mkdirSync(directory, { recursive: true });
const db = new Database(join(directory, 'pvh.sqlite'));
tuneDatabase(db);
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
for (const migration of migrations) {
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version)) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(migration.version);
    })();
  }
}
function readSettings(): Settings {
  const row = db.prepare('SELECT value FROM local_settings WHERE key = ?').get('preferences') as { value: string } | undefined;
  return settingsSchema.parse(row ? JSON.parse(row.value) : {});
}
function audit(action: string): void { db.prepare('INSERT INTO audit_events(action) VALUES (?)').run(action); }
function count(table: string): number { return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n; }
async function backup(): Promise<{ filename: string }> {
  const dir = join(directory, 'backups');
  mkdirSync(dir, { recursive: true });
  const filename = `pvh-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  await db.backup(join(dir, filename));
  const files = readdirSync(dir).filter(f => /^pvh-.*\.sqlite$/.test(f)).sort().reverse();
  for (const file of files.slice(7)) unlinkSync(join(dir, file));
  audit('database.backup');
  return { filename };
}
// Serialize async backups and shutdown as well as synchronous DB work.
let queue = Promise.resolve();
const checkpoint = setInterval(() => {
  queue = queue.then(() => { db.pragma('wal_checkpoint(PASSIVE)'); }).catch(() => {
    console.error('[database] CHECKPOINT_FAILED');
  });
}, 5 * 60_000);
checkpoint.unref();
port.on('message', (message: { id: number; method: string; payload?: unknown }) => {
  queue = queue.then(async () => {
    try {
      let data: unknown;
      switch (message.method) {
        case 'sync:get': {
          const {key}=message.payload as {key:string};
          const row=db.prepare('SELECT value FROM local_settings WHERE key=?').get(`sync:${key}`) as {value:string}|undefined;
          data=row?JSON.parse(row.value):0;break;
        }
        case 'sync:set': {
          const {key,cursor}=message.payload as {key:string;cursor:number};
          db.prepare('INSERT INTO local_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(excluded.value AS INTEGER)>CAST(local_settings.value AS INTEGER)').run(`sync:${key}`,JSON.stringify(cursor));data=true;break;
        }
        case 'bootstrap':
          data = { settings: readSettings(), database: {
            journalMode: db.pragma('journal_mode', { simple: true }), foreignKeys: db.pragma('foreign_keys', { simple: true }) === 1,
            migrationVersion: (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v,
            integrity: db.pragma('quick_check', { simple: true }), nativeAbi: process.versions.modules,
          }, counts: { customers: count('cached_customers'), conversations: count('cached_conversations') + count('zalo_threads'), messages: count('cached_messages') + count('zalo_messages'), pending: count('pending_operations') + count('zalo_gateway_outbox') },
          events: db.prepare('SELECT id, action, created_at AS createdAt FROM audit_events ORDER BY id DESC LIMIT 50').all() as AuditEvent[] };
          break;
        case 'settings': {
          const next = settingsSchema.parse({ ...readSettings(), ...settingsPatchSchema.parse(message.payload) });
          db.transaction(() => {
            db.prepare("INSERT INTO local_settings(key,value) VALUES ('preferences',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run(JSON.stringify(next));
            audit('settings.updated');
          })();
          data = next; break;
        }
        case 'window:get': {
          const row = db.prepare("SELECT value FROM local_settings WHERE key='window'").get() as { value: string } | undefined;
          data = row ? JSON.parse(row.value) : null; break;
        }
        case 'window:set':
          db.prepare("INSERT INTO local_settings(key,value) VALUES ('window',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run(JSON.stringify(message.payload));
          data = true; break;
        case 'backup': data = await backup(); break;
        case 'close': clearInterval(checkpoint); db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); data = true; break;
        default:
        if (message.method.startsWith('zalo:') || message.method.startsWith('inbox:')) data = zaloDatabaseOperation(db, message.method, message.payload);
          else throw new Error('Unknown database operation');
      }
      port.postMessage({ id: message.id, ok: true, data });
    } catch (error) {
      port.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : 'Database error' });
    }
  });
});
audit('app.started');
port.postMessage({ ready: true });