CREATE TABLE local_users (
  principal_id UUID PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'HUMAN' CHECK(kind='HUMAN'),
  username TEXT NOT NULL UNIQUE CHECK(username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
  password_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK(credential_version>0),
  system_role TEXT NOT NULL DEFAULT 'USER' CHECK(system_role IN ('ADMIN','USER')),
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(principal_id,kind) REFERENCES principals(id,kind)
);
CREATE TABLE agent_credentials (
  id UUID PRIMARY KEY,
  principal_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'AGENT' CHECK(kind='AGENT'),
  label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 120),
  token_hash BYTEA NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
  scopes TEXT[] NOT NULL CHECK(cardinality(scopes)>0 AND scopes <@ ARRAY['task:read','task:write']::TEXT[]),
  audiences TEXT[] NOT NULL CHECK(cardinality(audiences)>0 AND audiences <@ ARRAY['api','mcp']::TEXT[]),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(principal_id,kind) REFERENCES principals(id,kind)
);
CREATE INDEX agent_credentials_principal ON agent_credentials(principal_id);
CREATE TABLE login_throttles (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK(attempts>0),
  resets_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE security_events (
  id UUID PRIMARY KEY,
  actor_id UUID REFERENCES principals(id),
  target_id UUID REFERENCES principals(id),
  project_id UUID REFERENCES projects(id),
  action TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX login_throttle_expiry ON login_throttles(resets_at);
CREATE TRIGGER security_append_only BEFORE UPDATE OR DELETE ON security_events FOR EACH ROW EXECUTE FUNCTION reject_audit_change();
CREATE TRIGGER security_no_truncate BEFORE TRUNCATE ON security_events FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
ALTER TABLE audit_events DROP CONSTRAINT audit_events_project_id_actor_id_fkey;
ALTER TABLE audit_events ADD CONSTRAINT audit_actor_principal FOREIGN KEY(actor_id) REFERENCES principals(id);
CREATE FUNCTION validate_audit_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM project_members WHERE project_id=NEW.project_id AND principal_id=NEW.actor_id) THEN RETURN NEW; END IF;
  IF NEW.action IN ('member.changed','principal.disabled','principal.enabled','credential.revoked','credential.created')
    AND EXISTS(SELECT 1 FROM local_users u JOIN principals p ON p.id=u.principal_id WHERE u.principal_id=NEW.actor_id AND u.system_role='ADMIN' AND NOT p.disabled) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Audit actor must belong to project or administer identity' USING ERRCODE='23503';
END;
$$;
CREATE TRIGGER audit_actor_project BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION validate_audit_actor();
-- Legacy OIDC tables/history are retained. New auth requires a versioned local identity,
-- so previously issued OIDC cookies and JWTs stop authenticating without deleting history.
