-- Human validation is an audit acknowledgement after DONE, never a workflow gate.
ALTER TABLE work_items ADD COLUMN completion_version INTEGER CHECK(completion_version>0);
UPDATE work_items SET completion_version=version WHERE status='DONE';
ALTER TABLE work_items ADD CONSTRAINT completion_only_when_done
  CHECK ((status='DONE') = (completion_version IS NOT NULL));

CREATE TABLE task_validations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  work_revision INTEGER NOT NULL CHECK(work_revision>0),
  completion_version INTEGER NOT NULL CHECK(completion_version>0),
  principal_id UUID NOT NULL,
  principal_kind TEXT NOT NULL DEFAULT 'HUMAN' CHECK(principal_kind='HUMAN'),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id,task_id,completion_version),
  FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
  FOREIGN KEY(project_id,principal_id) REFERENCES project_members(project_id,principal_id),
  FOREIGN KEY(principal_id,principal_kind) REFERENCES principals(id,kind)
);
CREATE TRIGGER validation_append_only BEFORE UPDATE OR DELETE ON task_validations
  FOR EACH ROW EXECUTE FUNCTION reject_audit_change();
CREATE TRIGGER validation_no_truncate BEFORE TRUNCATE ON task_validations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
