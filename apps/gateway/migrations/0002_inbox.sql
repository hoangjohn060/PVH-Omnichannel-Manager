-- Phase 04: authoritative organization membership and explicit inbox grants.
ALTER TABLE gateway_credentials RENAME TO credentials_v3;
CREATE TABLE gateway_credentials (
 token_hash TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','manager','agent','viewer')),
 expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
INSERT INTO gateway_credentials SELECT * FROM credentials_v3;
DROP TABLE credentials_v3;
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE users (organization_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(organization_id,id));
CREATE TABLE memberships (
 organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager','agent','viewer')),
 active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(organization_id,user_id)
);
INSERT OR IGNORE INTO organizations SELECT org_id,org_id FROM gateway_credentials;
INSERT OR IGNORE INTO users SELECT org_id,user_id,user_id FROM gateway_credentials;
INSERT OR IGNORE INTO memberships SELECT org_id,user_id,role,1 FROM gateway_credentials;
CREATE TRIGGER credential_member AFTER INSERT ON gateway_credentials BEGIN
 INSERT OR IGNORE INTO organizations VALUES(NEW.org_id,NEW.org_id);
 INSERT OR IGNORE INTO users VALUES(NEW.org_id,NEW.user_id,NEW.user_id);
 INSERT OR IGNORE INTO memberships VALUES(NEW.org_id,NEW.user_id,NEW.role,1);
END;
CREATE TABLE channel_connections (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, platform TEXT NOT NULL CHECK(platform IN ('zalo','facebook')),
 external_id TEXT NOT NULL, name TEXT NOT NULL, connector_user_id TEXT,
 UNIQUE(organization_id,platform,external_id)
);
INSERT INTO channel_connections SELECT id,org_id,'facebook',page_id,name,NULL FROM fb_pages;
CREATE TRIGGER page_channel AFTER INSERT ON fb_pages BEGIN
 INSERT INTO channel_connections(id,organization_id,platform,external_id,name) VALUES(NEW.id,NEW.org_id,'facebook',NEW.page_id,NEW.name);
END;
CREATE TRIGGER page_channel_update AFTER UPDATE OF name ON fb_pages BEGIN
 UPDATE channel_connections SET name=NEW.name WHERE id=NEW.id AND organization_id=NEW.org_id;
END;
CREATE TABLE inbox_grants (organization_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(organization_id,channel_id,user_id));
CREATE TABLE customers (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT,
 tags TEXT NOT NULL DEFAULT '[]', care_notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE customer_identities (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id),
 platform TEXT NOT NULL, channel_id TEXT NOT NULL, external_id TEXT NOT NULL,
 UNIQUE(organization_id,platform,channel_id,external_id)
);
CREATE TABLE conversations (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, channel_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 external_id TEXT NOT NULL, thread_type INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PENDING','RESOLVED')),
 assigned_user_id TEXT, version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, preview TEXT NOT NULL DEFAULT '',
 UNIQUE(organization_id,channel_id,external_id)
);
CREATE INDEX inbox_conversation_page ON conversations(organization_id,updated_at DESC,id DESC);
CREATE TABLE conversation_assignments (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
 user_id TEXT, actor_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE messages (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, platform TEXT NOT NULL, channel_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL, external_message_id TEXT, direction TEXT NOT NULL CHECK(direction IN ('incoming','outgoing')),
 content TEXT NOT NULL, sender_id TEXT, sender_name TEXT NOT NULL, sender_type TEXT NOT NULL,
 agent_id TEXT, agent_name TEXT, sender_origin TEXT NOT NULL CHECK(sender_origin IN ('desktop_agent','zalo_native','facebook_native','external','system')),
 attribution_status TEXT NOT NULL CHECK(attribution_status IN ('verified','unknown')),
 source_created_at INTEGER NOT NULL, received_at INTEGER NOT NULL, send_status TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(organization_id,channel_id,external_message_id)
);
CREATE INDEX inbox_message_page ON messages(organization_id,conversation_id,source_created_at DESC,id DESC);
CREATE TABLE attachments (id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id), metadata TEXT NOT NULL);
CREATE TABLE internal_notes (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, conversation_id TEXT NOT NULL, actor_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE inbox_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE inbox_reads (organization_id TEXT NOT NULL, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at INTEGER NOT NULL, PRIMARY KEY(organization_id,conversation_id,user_id));
CREATE TABLE inbox_drafts (organization_id TEXT NOT NULL, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(organization_id,conversation_id,user_id));
CREATE TABLE inbox_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL, channel_id TEXT NOT NULL, conversation_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX inbox_change_cursor ON inbox_changes(organization_id,channel_id,seq);
CREATE TABLE inbox_send_jobs (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, channel_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
 message_id TEXT NOT NULL, agent_id TEXT NOT NULL, content_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','SENDING','ACCEPTED','SENT','FAILED','UNKNOWN')),
 attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX inbox_one_active_send ON inbox_send_jobs(organization_id,conversation_id) WHERE status IN ('PENDING','SENDING');
CREATE TRIGGER inbox_message_insert AFTER INSERT ON messages BEGIN
 UPDATE conversations SET updated_at=MAX(updated_at,NEW.source_created_at),preview=CASE WHEN NEW.source_created_at>=updated_at THEN substr(NEW.content,1,300) ELSE preview END,
 status=CASE WHEN NEW.direction='incoming' THEN 'OPEN' ELSE status END WHERE id=NEW.conversation_id;
 INSERT INTO inbox_changes(organization_id,channel_id,conversation_id,created_at) VALUES(NEW.organization_id,NEW.channel_id,NEW.conversation_id,NEW.received_at);
END;
CREATE TRIGGER inbox_message_update AFTER UPDATE ON messages BEGIN
 INSERT INTO inbox_changes(organization_id,channel_id,conversation_id,created_at) VALUES(NEW.organization_id,NEW.channel_id,NEW.conversation_id,NEW.received_at);
END;
-- Project the durable Meta journal without polling or changing its original content.
CREATE TRIGGER fb_inbox_insert AFTER INSERT ON fb_messages BEGIN
 INSERT OR IGNORE INTO customers(id,organization_id,name,created_at,updated_at)
 SELECT 'facebook:'||p.id||':'||NEW.psid,p.org_id,NEW.psid,NEW.timestamp,NEW.timestamp FROM fb_pages p WHERE p.id=NEW.connection_id;
 INSERT OR IGNORE INTO customer_identities
 SELECT 'facebook:'||p.id||':'||NEW.psid,p.org_id,'facebook:'||p.id||':'||NEW.psid,'facebook',p.id,NEW.psid FROM fb_pages p WHERE p.id=NEW.connection_id;
 INSERT OR IGNORE INTO conversations(id,organization_id,channel_id,customer_id,external_id,created_at,updated_at)
 SELECT 'facebook:'||p.id||':'||NEW.psid,p.org_id,p.id,'facebook:'||p.id||':'||NEW.psid,NEW.psid,NEW.timestamp,NEW.timestamp FROM fb_pages p WHERE p.id=NEW.connection_id;
 INSERT OR IGNORE INTO messages
 SELECT 'facebook:'||p.id||':'||NEW.message_id,p.org_id,'facebook',p.id,'facebook:'||p.id||':'||NEW.psid,NEW.message_id,NEW.direction,NEW.text,
 CASE WHEN NEW.direction='incoming' THEN NEW.psid ELSE p.page_id END,
 CASE WHEN NEW.direction='incoming' THEN NEW.psid ELSE p.name END,
 CASE WHEN NEW.direction='incoming' THEN 'customer' ELSE 'page' END,
 NEW.agent_id,(SELECT name FROM users WHERE organization_id=p.org_id AND id=NEW.agent_id),
 CASE WHEN NEW.agent_id IS NOT NULL THEN 'desktop_agent' WHEN NEW.direction='outgoing' THEN 'facebook_native' ELSE 'external' END,
 CASE WHEN NEW.agent_id IS NULL THEN 'unknown' ELSE 'verified' END,
 NEW.timestamp,CAST(unixepoch('subsec')*1000 AS INTEGER),NEW.status,CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM fb_pages p WHERE p.id=NEW.connection_id;
 INSERT OR IGNORE INTO attachments SELECT 'facebook:'||NEW.connection_id||':'||NEW.message_id,'facebook:'||NEW.connection_id||':'||NEW.message_id,NEW.attachments
 WHERE NEW.attachments!='[]' AND EXISTS(SELECT 1 FROM messages WHERE id='facebook:'||NEW.connection_id||':'||NEW.message_id);
 UPDATE customers SET updated_at=MAX(updated_at,NEW.timestamp) WHERE id='facebook:'||NEW.connection_id||':'||NEW.psid;
END;
CREATE TRIGGER fb_inbox_update AFTER UPDATE ON fb_messages BEGIN
 UPDATE messages SET send_status=NEW.status,
 agent_id=COALESCE(agent_id,NEW.agent_id),
 agent_name=COALESCE(agent_name,(SELECT u.name FROM users u JOIN fb_pages p ON p.org_id=u.organization_id WHERE p.id=NEW.connection_id AND u.id=NEW.agent_id)),
 sender_origin=CASE WHEN NEW.agent_id IS NOT NULL THEN 'desktop_agent' ELSE sender_origin END,
 attribution_status=CASE WHEN NEW.agent_id IS NOT NULL THEN 'verified' ELSE attribution_status END
 WHERE channel_id=NEW.connection_id AND external_message_id=NEW.message_id;
END;
-- Replay existing immutable journal rows through the projection trigger once.
CREATE TABLE fb_projection_backfill AS SELECT * FROM fb_messages;
DELETE FROM fb_messages;
INSERT INTO fb_messages SELECT * FROM fb_projection_backfill;
DROP TABLE fb_projection_backfill;