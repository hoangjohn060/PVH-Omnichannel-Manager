export const migrations = [{ version: 1, sql: `
CREATE TABLE local_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE cached_customers (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
CREATE INDEX idx_customers_name ON cached_customers(display_name);
CREATE INDEX idx_customers_updated ON cached_customers(updated_at);
CREATE TABLE cached_conversations (id TEXT PRIMARY KEY, channel TEXT NOT NULL CHECK(channel IN ('zalo','facebook')), customer_id TEXT REFERENCES cached_customers(id) ON DELETE SET NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}');
CREATE INDEX idx_conversations_channel_updated ON cached_conversations(channel, updated_at);
CREATE INDEX idx_conversations_customer ON cached_conversations(customer_id);
CREATE TABLE cached_messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES cached_conversations(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}');
CREATE INDEX idx_messages_conversation_date ON cached_messages(conversation_id, created_at);
CREATE TABLE connector_sessions (id TEXT PRIMARY KEY, channel TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'not_connected', encrypted_secret BLOB, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE pending_operations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_operations_status_date ON pending_operations(status, created_at);
CREATE TABLE sync_cursors (connector_id TEXT PRIMARY KEY REFERENCES connector_sessions(id) ON DELETE CASCADE, cursor TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES pending_operations(id) ON DELETE CASCADE, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_outbox_status_attempt ON sync_outbox(status, next_attempt_at);
CREATE INDEX idx_outbox_operation ON sync_outbox(operation_id);
CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_audit_created ON audit_events(created_at);
` }, { version: 2, sql: `
CREATE TABLE zalo_accounts (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, uid TEXT UNIQUE, display_name TEXT, avatar TEXT,
  owner_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'DISCONNECTED', encrypted_session BLOB,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_zalo_accounts_owner ON zalo_accounts(owner_id);
CREATE TABLE zalo_threads (
  account_id TEXT NOT NULL REFERENCES zalo_accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL, thread_type INTEGER NOT NULL CHECK(thread_type IN (0,1)), title TEXT NOT NULL,
  updated_at INTEGER NOT NULL, preview TEXT NOT NULL, PRIMARY KEY(account_id,thread_id)
);
CREATE INDEX idx_zalo_threads_updated ON zalo_threads(account_id,updated_at DESC);
CREATE TABLE zalo_messages (
  platform TEXT NOT NULL CHECK(platform='zalo'), account_id TEXT NOT NULL,
  message_id TEXT NOT NULL, thread_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY(platform,account_id,message_id),
  FOREIGN KEY(account_id,thread_id) REFERENCES zalo_threads(account_id,thread_id) ON DELETE CASCADE
);
CREATE INDEX idx_zalo_messages_thread ON zalo_messages(account_id,thread_id,timestamp);
CREATE TABLE zalo_outbound (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES zalo_accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL, thread_type INTEGER NOT NULL, text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SENDING','SENT','FAILED','UNKNOWN')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts <= 1), external_id TEXT, error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_zalo_outbound_failed ON zalo_outbound(account_id,status,created_at);
CREATE TABLE zalo_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES zalo_accounts(id) ON DELETE CASCADE, code TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX idx_zalo_logs_account ON zalo_logs(account_id,id DESC);
CREATE TABLE zalo_gateway_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES zalo_accounts(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
  UNIQUE(account_id,message_id)
);
` }, { version: 3, sql: `
CREATE TABLE inbox_connector_results (job_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE inbox_connector_attempts (job_id TEXT NOT NULL, attempt INTEGER NOT NULL, request_id TEXT NOT NULL, PRIMARY KEY(job_id,attempt));
CREATE TABLE inbox_connector_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, message_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', UNIQUE(account_id,message_id));
INSERT INTO inbox_connector_outbox(account_id,message_id,payload) SELECT account_id,message_id,payload FROM zalo_messages;
` }];