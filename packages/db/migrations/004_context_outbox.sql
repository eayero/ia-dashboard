CREATE TABLE context_snapshots (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  principal_id UUID NOT NULL,
  seq BIGINT NOT NULL CHECK(seq>=0),
  page_size INTEGER NOT NULL CHECK(page_size BETWEEN 1 AND 100),
  page_count INTEGER NOT NULL DEFAULT 1 CHECK(page_count>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp()+interval '10 minutes'),
  FOREIGN KEY(project_id,principal_id) REFERENCES project_members(project_id,principal_id)
);
CREATE INDEX context_snapshot_expiry ON context_snapshots(expires_at);
CREATE TABLE context_snapshot_pages (
  snapshot_id UUID NOT NULL REFERENCES context_snapshots(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL CHECK(page_index>=0),
  records JSONB NOT NULL CHECK(jsonb_typeof(records)='array'),
  PRIMARY KEY(snapshot_id,page_index)
);
CREATE INDEX claims_project_context ON task_claims(project_id,task_id);
CREATE INDEX approvals_project_context ON approvals(project_id,id);
CREATE INDEX alerts_project_context ON task_alerts(project_id,id);

ALTER TABLE event_outbox
  ADD COLUMN claim_token UUID,
  ADD COLUMN locked_until TIMESTAMPTZ,
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN last_error_code TEXT,
  ADD CONSTRAINT outbox_claim_pair CHECK((claim_token IS NULL)=(locked_until IS NULL));
CREATE INDEX outbox_retry_pending ON event_outbox(next_attempt_at,created_at,event_id) WHERE published_at IS NULL;
