-- Phase 06. Identity, expiring device sessions and distributed connector fencing.
DROP TRIGGER credential_member;
CREATE TABLE memberships_next (
 organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('super_admin','admin','manager','agent','viewer')),
 active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(organization_id,user_id)
);
INSERT INTO memberships_next SELECT * FROM memberships;
DROP TABLE memberships;
ALTER TABLE memberships_next RENAME TO memberships;
CREATE TRIGGER credential_member AFTER INSERT ON gateway_credentials BEGIN
 INSERT OR IGNORE INTO organizations VALUES(NEW.org_id,NEW.org_id);
 INSERT OR IGNORE INTO users VALUES(NEW.org_id,NEW.user_id,NEW.user_id);
 INSERT OR IGNORE INTO memberships VALUES(NEW.org_id,NEW.user_id,NEW.role,1);
END;
CREATE TABLE employee_auth (
 email TEXT PRIMARY KEY COLLATE NOCASE, organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
 password_hash TEXT NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(organization_id,user_id)
);
CREATE TABLE employee_sessions (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
 access_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE,
 access_expires INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE INDEX employee_session_user ON employee_sessions(organization_id,user_id);
CREATE TABLE auth_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL);
CREATE TABLE connector_leases (
 organization_id TEXT NOT NULL, channel_id TEXT NOT NULL, device_id TEXT NOT NULL,
 user_id TEXT NOT NULL, fence TEXT NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,channel_id)
);
CREATE TABLE connector_job_claims (
 job_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, device_id TEXT NOT NULL, fence TEXT NOT NULL
);
-- Prevent a second locally-generated account UUID from starting the same real Zalo listener.
CREATE UNIQUE INDEX zalo_account_owner ON channel_connections(external_id) WHERE platform='zalo';
CREATE TRIGGER membership_revoke AFTER UPDATE OF active,role ON memberships BEGIN
 UPDATE employee_sessions SET revoked=1 WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id;
 UPDATE gateway_credentials SET revoked=1 WHERE org_id=NEW.organization_id AND user_id=NEW.user_id;
 DELETE FROM connector_leases WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id;
END;
CREATE TRIGGER membership_delete AFTER DELETE ON memberships BEGIN
 UPDATE employee_sessions SET revoked=1 WHERE organization_id=OLD.organization_id AND user_id=OLD.user_id;
 UPDATE gateway_credentials SET revoked=1 WHERE org_id=OLD.organization_id AND user_id=OLD.user_id;
 DELETE FROM connector_leases WHERE organization_id=OLD.organization_id AND user_id=OLD.user_id;
END;