-- Existing rows and evidence remain immutable; duplicates require an explicit
-- reconciliation rather than silently merging identities during migration.
ALTER TABLE repositories ADD CONSTRAINT repositories_project_url_key UNIQUE(project_id,url);

ALTER TABLE audit_events DROP CONSTRAINT audit_events_entity_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_entity_type_check
  CHECK(entity_type IN ('TASK','SESSION','PRINCIPAL','REQUIREMENT','REPOSITORY'));
CREATE OR REPLACE FUNCTION validate_audit_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_type='TASK' THEN
    PERFORM 1 FROM work_items WHERE project_id=NEW.project_id AND id=NEW.entity_id;
  ELSIF NEW.entity_type='SESSION' THEN
    PERFORM 1 FROM agent_sessions WHERE project_id=NEW.project_id AND id=NEW.entity_id;
  ELSIF NEW.entity_type='REQUIREMENT' THEN
    PERFORM 1 FROM requirements WHERE project_id=NEW.project_id AND id=NEW.entity_id;
  ELSIF NEW.entity_type='REPOSITORY' THEN
    PERFORM 1 FROM repositories WHERE project_id=NEW.project_id AND id=NEW.entity_id;
  ELSE
    PERFORM 1 FROM project_members WHERE project_id=NEW.project_id AND principal_id=NEW.entity_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Audit entity does not belong to project' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END; $$;
