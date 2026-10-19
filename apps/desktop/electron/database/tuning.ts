import type Database from 'better-sqlite3';

export function tuneDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -8192'); // Suggested 8 MiB page cache, not an RSS limit.
  db.pragma('mmap_size = 0');
  db.pragma('journal_size_limit = 16777216');
  db.pragma('wal_autocheckpoint = 1000');
  // Keep the durability default; do not trade committed messages for throughput.
  db.pragma('synchronous = FULL');
}