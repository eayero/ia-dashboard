CREATE TABLE principals (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('HUMAN','AGENT')),
  disabled BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  archived BOOLEAN NOT NULL DEFAULT false,
  claims_paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id),
  principal_id UUID NOT NULL REFERENCES principals(id),
  roles TEXT[] NOT NULL DEFAULT '{}',
  scopes TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY(project_id, principal_id),
  CHECK (roles <@ ARRAY['OWNER','ADMIN','MANAGER','REVIEWER','VIEWER']::TEXT[])
);
-- Logical ACC sessions are distinct from HTTP/OIDC and MCP sessions.
CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  principal_id UUID NOT NULL,
  ended_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + interval '30 minutes'),
  UNIQUE(project_id, principal_id, id),
  FOREIGN KEY(project_id, principal_id) REFERENCES project_members(project_id, principal_id)
);
CREATE TABLE work_items (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  public_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  criteria JSONB NOT NULL CHECK (jsonb_typeof(criteria)='array' AND jsonb_array_length(criteria)>0),
  status TEXT NOT NULL DEFAULT 'BACKLOG' CHECK (status IN ('BACKLOG','READY','IN_PROGRESS','BLOCKED','IN_REVIEW','IN_QA','DONE','CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  work_revision INTEGER NOT NULL DEFAULT 1 CHECK (work_revision>0),
  external_ref TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id, id),
  UNIQUE(project_id, public_id),
  UNIQUE(project_id, external_ref),
  FOREIGN KEY(project_id, created_by) REFERENCES project_members(project_id, principal_id)
);
CREATE TABLE task_claims (
  project_id UUID NOT NULL,
  task_id UUID PRIMARY KEY,
  principal_id UUID NOT NULL,
  session_id UUID NOT NULL,
  fencing_token BIGINT NOT NULL CHECK (fencing_token>0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY(project_id, task_id) REFERENCES work_items(project_id, id),
  FOREIGN KEY(project_id, principal_id, session_id) REFERENCES agent_sessions(project_id, principal_id, id)
);
CREATE TABLE project_counters (
  project_id UUID NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('TASK','EVENT')),
  value BIGINT NOT NULL CHECK(value>0),
  PRIMARY KEY(project_id, kind)
);
CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  seq BIGINT NOT NULL CHECK (seq>0),
  actor_id UUID NOT NULL,
  session_id UUID,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version=1),
  trace_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id, seq),
  FOREIGN KEY(project_id, actor_id) REFERENCES project_members(project_id, principal_id),
  FOREIGN KEY(project_id, entity_id) REFERENCES work_items(project_id, id),
  FOREIGN KEY(project_id, actor_id, session_id) REFERENCES agent_sessions(project_id, principal_id, id)
);
CREATE FUNCTION reject_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_change();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
CREATE TABLE event_outbox (
  event_id UUID PRIMARY KEY REFERENCES audit_events(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0)
);
CREATE INDEX outbox_pending ON event_outbox(created_at) WHERE published_at IS NULL;
CREATE TABLE idempotency_records (
  project_id UUID NOT NULL,
  principal_id UUID NOT NULL,
  command TEXT NOT NULL,
  key TEXT NOT NULL CHECK(length(key) BETWEEN 1 AND 200),
  payload_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + interval '7 days'),
  PRIMARY KEY(project_id, principal_id, command, key),
  FOREIGN KEY(project_id, principal_id) REFERENCES project_members(project_id, principal_id)
);
