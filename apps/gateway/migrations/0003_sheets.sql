-- Sheets is a projection, never a transport queue. Triggers participate in source transactions.
CREATE TABLE sheets_credentials (
 organization_id TEXT PRIMARY KEY, client_email TEXT NOT NULL, encrypted_key TEXT NOT NULL,
 encrypted_token TEXT, token_expires_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sheets_config (
 organization_id TEXT PRIMARY KEY, spreadsheet_id TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 0, redact INTEGER NOT NULL DEFAULT 1,
 verified_at INTEGER, initialized INTEGER NOT NULL DEFAULT 0, last_sync_at INTEGER, error TEXT, next_attempt INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sheets_outbox (
 organization_id TEXT NOT NULL, tab TEXT NOT NULL, logical_key TEXT NOT NULL,
 payload TEXT NOT NULL, row_index INTEGER NOT NULL CHECK(row_index>=2), revision INTEGER NOT NULL DEFAULT 1,
 synced_revision INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT,
 PRIMARY KEY(organization_id,tab,logical_key), UNIQUE(organization_id,tab,row_index)
);
CREATE INDEX sheets_pending ON sheets_outbox(organization_id,next_attempt);
CREATE TABLE sheets_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL,
 code TEXT NOT NULL, record_count INTEGER NOT NULL, created_at INTEGER NOT NULL
);
ALTER TABLE conversations ADD COLUMN resolved_at INTEGER;
CREATE TRIGGER sheets_resolved AFTER UPDATE OF status ON conversations BEGIN
 UPDATE conversations SET resolved_at=CASE WHEN NEW.status='RESOLVED' THEN CAST(unixepoch('subsec')*1000 AS INTEGER) ELSE NULL END WHERE id=NEW.id;
END;

CREATE VIEW sheets_customers AS
 SELECT i.organization_id,i.id AS logical_key,json_array(c.id,i.platform,i.external_id,c.name,ch.name,c.created_at,
 COALESCE((SELECT MAX(m.source_created_at) FROM messages m JOIN conversations v ON v.id=m.conversation_id WHERE v.customer_id=c.id),c.updated_at),
 (SELECT COUNT(*) FROM conversations v WHERE v.customer_id=c.id AND v.channel_id=i.channel_id)) AS payload
 FROM customer_identities i JOIN customers c ON c.id=i.customer_id JOIN channel_connections ch ON ch.id=i.channel_id;
CREATE VIEW sheets_messages AS
 SELECT m.organization_id,m.id AS logical_key,json_array(m.id,m.conversation_id,m.platform,ch.name,c.id,c.name,m.direction,
 m.sender_name,m.sender_type,m.agent_id,m.agent_name,m.content,'',m.source_created_at,m.received_at,m.send_status,m.attribution_status) AS payload
 FROM messages m JOIN conversations v ON v.id=m.conversation_id JOIN customers c ON c.id=v.customer_id JOIN channel_connections ch ON ch.id=m.channel_id;
CREATE VIEW sheets_conversations AS
 SELECT v.organization_id,v.id AS logical_key,json_array(v.id,v.customer_id,ch.platform,v.assigned_user_id,v.status,v.created_at,
 (SELECT MAX(source_created_at) FROM messages WHERE conversation_id=v.id),
 (SELECT MIN(source_created_at) FROM messages WHERE conversation_id=v.id AND direction='outgoing' AND agent_id IS NOT NULL AND send_status IN ('ACCEPTED','SENT','DELIVERED','READ','SEEN')
 AND source_created_at>=(SELECT MIN(source_created_at) FROM messages WHERE conversation_id=v.id AND direction='incoming')),
 v.resolved_at,(SELECT COUNT(*) FROM messages WHERE conversation_id=v.id AND direction='incoming'),
 (SELECT COUNT(*) FROM messages WHERE conversation_id=v.id AND direction='outgoing')) AS payload
 FROM conversations v JOIN channel_connections ch ON ch.id=v.channel_id;
CREATE VIEW sheets_report_keys AS
 SELECT organization_id,agent_id,platform,date(source_created_at/1000,'unixepoch') AS period FROM messages WHERE agent_id IS NOT NULL
 UNION SELECT a.organization_id,a.user_id,ch.platform,date(a.created_at/1000,'unixepoch') FROM conversation_assignments a JOIN conversations v ON v.id=a.conversation_id JOIN channel_connections ch ON ch.id=v.channel_id WHERE a.user_id IS NOT NULL;
CREATE VIEW sheets_agent_reports AS
 SELECT k.organization_id,json_array(k.agent_id,k.platform,k.period) AS logical_key,
 json_array(k.agent_id,u.name,k.platform,k.period,
 (SELECT COUNT(DISTINCT a.conversation_id) FROM conversation_assignments a JOIN conversations v ON v.id=a.conversation_id JOIN channel_connections ch ON ch.id=v.channel_id WHERE a.organization_id=k.organization_id AND a.user_id=k.agent_id AND ch.platform=k.platform AND date(a.created_at/1000,'unixepoch')=k.period),
 (SELECT COUNT(DISTINCT m.conversation_id) FROM messages m WHERE m.organization_id=k.organization_id AND m.agent_id=k.agent_id AND m.platform=k.platform AND date(m.source_created_at/1000,'unixepoch')=k.period AND m.send_status IN ('ACCEPTED','SENT','DELIVERED','READ','SEEN')),
 (SELECT COUNT(*) FROM messages m WHERE m.organization_id=k.organization_id AND m.agent_id=k.agent_id AND m.platform=k.platform AND date(m.source_created_at/1000,'unixepoch')=k.period AND m.direction='outgoing' AND m.send_status IN ('ACCEPTED','SENT','DELIVERED','READ','SEEN')),
 (SELECT AVG((r.first_reply-r.first_incoming)/1000.0) FROM (
 SELECT conversation_id,MIN(source_created_at) AS first_reply,
 (SELECT MIN(i.source_created_at) FROM messages i WHERE i.conversation_id=m.conversation_id AND i.direction='incoming') AS first_incoming
 FROM messages m WHERE m.organization_id=k.organization_id AND m.agent_id=k.agent_id AND m.platform=k.platform AND m.direction='outgoing' AND m.send_status IN ('ACCEPTED','SENT','DELIVERED','READ','SEEN') AND date(m.source_created_at/1000,'unixepoch')=k.period GROUP BY conversation_id
 ) r WHERE r.first_reply>=r.first_incoming)) AS payload
 FROM sheets_report_keys k LEFT JOIN users u ON u.organization_id=k.organization_id AND u.id=k.agent_id;
CREATE TRIGGER sheets_message_insert AFTER INSERT ON messages BEGIN
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'MESSAGES',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='MESSAGES'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_messages v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='MESSAGES' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (v.logical_key=NEW.id)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CONVERSATIONS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CONVERSATIONS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_conversations v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CONVERSATIONS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (v.logical_key=NEW.conversation_id)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CUSTOMERS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CUSTOMERS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_customers v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CUSTOMERS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (json_extract(v.payload,'$[0]')=(SELECT customer_id FROM conversations WHERE id=NEW.conversation_id))
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'AGENT_REPORTS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='AGENT_REPORTS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_agent_reports v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='AGENT_REPORTS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (json_extract(v.payload,'$[2]')=NEW.platform AND json_extract(v.payload,'$[3]')=date(NEW.source_created_at/1000,'unixepoch'))
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
END;

CREATE TRIGGER sheets_message_update AFTER UPDATE ON messages BEGIN
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'MESSAGES',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='MESSAGES'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_messages v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='MESSAGES' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (v.logical_key=NEW.id)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CONVERSATIONS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CONVERSATIONS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_conversations v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CONVERSATIONS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (v.logical_key=NEW.conversation_id)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CUSTOMERS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CUSTOMERS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_customers v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CUSTOMERS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (json_extract(v.payload,'$[0]')=(SELECT customer_id FROM conversations WHERE id=NEW.conversation_id))
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'AGENT_REPORTS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='AGENT_REPORTS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_agent_reports v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='AGENT_REPORTS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (json_extract(v.payload,'$[2]')=NEW.platform AND json_extract(v.payload,'$[3]')=date(NEW.source_created_at/1000,'unixepoch'))
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
END;

CREATE TRIGGER sheets_message_delete AFTER DELETE ON messages BEGIN
UPDATE sheets_outbox SET payload='[]',revision=revision+1,next_attempt=0 WHERE organization_id=OLD.organization_id AND tab='MESSAGES' AND logical_key=OLD.id;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CONVERSATIONS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CONVERSATIONS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_conversations v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CONVERSATIONS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=OLD.organization_id AND (v.logical_key=OLD.conversation_id)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CUSTOMERS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CUSTOMERS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_customers v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CUSTOMERS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=OLD.organization_id AND (json_extract(v.payload,'$[0]')=(SELECT customer_id FROM conversations WHERE id=OLD.conversation_id))
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'AGENT_REPORTS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='AGENT_REPORTS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_agent_reports v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='AGENT_REPORTS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=OLD.organization_id AND (json_extract(v.payload,'$[2]')=OLD.platform AND json_extract(v.payload,'$[3]')=date(OLD.source_created_at/1000,'unixepoch'))
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
END;
CREATE TRIGGER sheets_customers AFTER UPDATE ON customers BEGIN
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CUSTOMERS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CUSTOMERS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_customers v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CUSTOMERS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (json_extract(v.payload,'$[0]')=NEW.id)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
END;
CREATE TRIGGER sheets_conversations AFTER UPDATE ON conversations BEGIN
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CONVERSATIONS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CONVERSATIONS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_conversations v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CONVERSATIONS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (v.logical_key=NEW.id)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
END;
CREATE TRIGGER sheets_conversation_assignments AFTER INSERT ON conversation_assignments BEGIN
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'AGENT_REPORTS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='AGENT_REPORTS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_agent_reports v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='AGENT_REPORTS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (1)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
END;
CREATE TRIGGER sheets_users AFTER UPDATE ON users BEGIN
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'AGENT_REPORTS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='AGENT_REPORTS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_agent_reports v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='AGENT_REPORTS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=NEW.organization_id AND (json_extract(v.payload,'$[0]')=NEW.id)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
END;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CUSTOMERS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CUSTOMERS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_customers v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CUSTOMERS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=v.organization_id AND (1)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'MESSAGES',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='MESSAGES'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_messages v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='MESSAGES' AND o.logical_key=v.logical_key
 WHERE v.organization_id=v.organization_id AND (1)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'CONVERSATIONS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='CONVERSATIONS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_conversations v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='CONVERSATIONS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=v.organization_id AND (1)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
INSERT INTO sheets_outbox(organization_id,tab,logical_key,payload,row_index)
 SELECT v.organization_id,'AGENT_REPORTS',v.logical_key,v.payload,COALESCE(o.row_index,COALESCE((SELECT MAX(row_index) FROM sheets_outbox WHERE organization_id=v.organization_id AND tab='AGENT_REPORTS'),1)+ROW_NUMBER() OVER(ORDER BY v.logical_key))
 FROM sheets_agent_reports v LEFT JOIN sheets_outbox o ON o.organization_id=v.organization_id AND o.tab='AGENT_REPORTS' AND o.logical_key=v.logical_key
 WHERE v.organization_id=v.organization_id AND (1)
 ON CONFLICT(organization_id,tab,logical_key) DO UPDATE SET payload=excluded.payload,revision=revision+1,attempts=0,next_attempt=0,error=NULL WHERE payload!=excluded.payload;
