PRAGMA foreign_keys = ON;
CREATE TABLE gateway_credentials (
 token_hash TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','agent')), expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE fb_oauth (
 id TEXT PRIMARY KEY, state_hash TEXT UNIQUE NOT NULL, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX fb_oauth_owner ON fb_oauth(org_id,user_id);
CREATE TABLE fb_candidates (
 transaction_id TEXT NOT NULL REFERENCES fb_oauth(id) ON DELETE CASCADE, page_id TEXT NOT NULL,
 name TEXT NOT NULL, token TEXT NOT NULL, permissions TEXT NOT NULL, tasks TEXT NOT NULL,
 PRIMARY KEY(transaction_id,page_id)
);
CREATE TABLE fb_pages (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, page_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 token TEXT, status TEXT NOT NULL, permissions TEXT NOT NULL, webhook INTEGER NOT NULL DEFAULT 0,
 checked_at INTEGER, owner_id TEXT NOT NULL, error TEXT
);
CREATE INDEX fb_pages_org ON fb_pages(org_id);
CREATE TABLE fb_events (
 event_key TEXT PRIMARY KEY, org_id TEXT NOT NULL, connection_id TEXT NOT NULL REFERENCES fb_pages(id),
 payload TEXT NOT NULL, received_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT
);
CREATE INDEX fb_events_pending ON fb_events(status,next_attempt);
CREATE TABLE fb_threads (
 connection_id TEXT NOT NULL REFERENCES fb_pages(id), psid TEXT NOT NULL, conversation_id TEXT NOT NULL,
 last_inbound INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(connection_id,psid)
);
CREATE TABLE fb_messages (
 connection_id TEXT NOT NULL REFERENCES fb_pages(id), message_id TEXT NOT NULL, psid TEXT NOT NULL,
 direction TEXT NOT NULL, text TEXT NOT NULL, attachments TEXT NOT NULL, timestamp INTEGER NOT NULL,
 agent_id TEXT, status TEXT NOT NULL, PRIMARY KEY(connection_id,message_id)
);
CREATE INDEX fb_messages_thread ON fb_messages(connection_id,psid,timestamp);
CREATE TABLE fb_receipts (
 connection_id TEXT NOT NULL REFERENCES fb_pages(id), psid TEXT NOT NULL, message_id TEXT NOT NULL,
 PRIMARY KEY(connection_id,psid,message_id)
);
CREATE TABLE fb_read_watermarks (
 connection_id TEXT NOT NULL REFERENCES fb_pages(id), psid TEXT NOT NULL, watermark INTEGER NOT NULL,
 PRIMARY KEY(connection_id,psid)
);
CREATE TABLE fb_outbound (
 request_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, connection_id TEXT NOT NULL REFERENCES fb_pages(id), psid TEXT NOT NULL,
 agent_id TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT,
 error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE fb_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, connection_id TEXT,
 code TEXT NOT NULL, subcode INTEGER, trace TEXT, created_at INTEGER NOT NULL
);