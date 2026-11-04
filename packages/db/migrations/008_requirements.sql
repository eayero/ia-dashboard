ALTER TABLE project_counters DROP CONSTRAINT project_counters_kind_check;
ALTER TABLE project_counters ADD CONSTRAINT project_counters_kind_check CHECK(kind IN ('TASK','EVENT','REQ'));
CREATE TABLE requirements (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  public_id TEXT NOT NULL,
  external_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK(current_revision>0),
  approved_revision INTEGER,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id,id), UNIQUE(project_id,public_id), UNIQUE(project_id,external_ref),
  FOREIGN KEY(project_id,created_by) REFERENCES project_members(project_id,principal_id)
);
CREATE TABLE requirement_revisions (
  project_id UUID NOT NULL,
  requirement_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  type TEXT NOT NULL CHECK(type IN ('FUNCTIONAL','NON_FUNCTIONAL')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 4000),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','APPROVED','SUPERSEDED')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  approved_by UUID,
  approved_kind TEXT GENERATED ALWAYS AS ('HUMAN') STORED,
  approved_at TIMESTAMPTZ,
  PRIMARY KEY(project_id,requirement_id,revision),
  FOREIGN KEY(project_id,requirement_id) REFERENCES requirements(project_id,id),
  FOREIGN KEY(project_id,created_by) REFERENCES project_members(project_id,principal_id),
  FOREIGN KEY(project_id,approved_by) REFERENCES project_members(project_id,principal_id),
  FOREIGN KEY(approved_by,approved_kind) REFERENCES principals(id,kind),
  CHECK((approved_by IS NULL)=(approved_at IS NULL)),
  CHECK(status<>'APPROVED' OR approved_by IS NOT NULL)
);
CREATE UNIQUE INDEX requirement_one_draft ON requirement_revisions(project_id,requirement_id) WHERE status='DRAFT';
CREATE UNIQUE INDEX requirement_one_approved ON requirement_revisions(project_id,requirement_id) WHERE status='APPROVED';
ALTER TABLE requirements ADD FOREIGN KEY(project_id,id,current_revision) REFERENCES requirement_revisions(project_id,requirement_id,revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE requirements ADD FOREIGN KEY(project_id,id,approved_revision) REFERENCES requirement_revisions(project_id,requirement_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION protect_requirement_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Requirement history is immutable' USING ERRCODE='55000'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at','approved_kind']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at','approved_kind'])
     OR NOT ((OLD.status='DRAFT' AND NEW.status='APPROVED' AND NEW.approved_by IS NOT NULL)
       OR (OLD.status IN ('DRAFT','APPROVED') AND NEW.status='SUPERSEDED' AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at)) THEN
    RAISE EXCEPTION 'Requirement history is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER requirement_revision_immutable BEFORE UPDATE OR DELETE ON requirement_revisions FOR EACH ROW EXECUTE FUNCTION protect_requirement_revision();
CREATE TRIGGER requirement_revision_no_truncate BEFORE TRUNCATE ON requirement_revisions FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
CREATE TABLE requirement_task_links (
  project_id UUID NOT NULL,
  requirement_id UUID NOT NULL,
  task_id UUID NOT NULL,
  evaluated_revision INTEGER,
  PRIMARY KEY(project_id,requirement_id,task_id),
  FOREIGN KEY(project_id,requirement_id) REFERENCES requirements(project_id,id),
  FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
  FOREIGN KEY(project_id,requirement_id,evaluated_revision) REFERENCES requirement_revisions(project_id,requirement_id,revision)
);
CREATE TABLE requirement_impact_reviews (
  id UUID PRIMARY KEY, project_id UUID NOT NULL, requirement_id UUID NOT NULL,
  task_id UUID NOT NULL, revision INTEGER NOT NULL, reason TEXT NOT NULL,
  principal_id UUID NOT NULL, principal_kind TEXT GENERATED ALWAYS AS ('HUMAN') STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,requirement_id,revision) REFERENCES requirement_revisions(project_id,requirement_id,revision),
  FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
  FOREIGN KEY(project_id,principal_id) REFERENCES project_members(project_id,principal_id),
  FOREIGN KEY(principal_id,principal_kind) REFERENCES principals(id,kind)
);
CREATE TRIGGER requirement_review_immutable BEFORE UPDATE OR DELETE ON requirement_impact_reviews FOR EACH ROW EXECUTE FUNCTION reject_audit_change();
CREATE TRIGGER requirement_review_no_truncate BEFORE TRUNCATE ON requirement_impact_reviews FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
CREATE TABLE requirement_impact_alerts (
  id UUID PRIMARY KEY, project_id UUID NOT NULL, requirement_id UUID NOT NULL,
  task_id UUID NOT NULL, revision INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,requirement_id,revision) REFERENCES requirement_revisions(project_id,requirement_id,revision),
  FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id)
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_entity_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_entity_type_check CHECK(entity_type IN ('TASK','SESSION','PRINCIPAL','REQUIREMENT'));
CREATE OR REPLACE FUNCTION validate_audit_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_type='TASK' THEN
    PERFORM 1 FROM work_items WHERE project_id=NEW.project_id AND id=NEW.entity_id;
  ELSIF NEW.entity_type='SESSION' THEN
    PERFORM 1 FROM agent_sessions WHERE project_id=NEW.project_id AND id=NEW.entity_id;
  ELSIF NEW.entity_type='REQUIREMENT' THEN
    PERFORM 1 FROM requirements WHERE project_id=NEW.project_id AND id=NEW.entity_id;
  ELSE
    PERFORM 1 FROM project_members WHERE project_id=NEW.project_id AND principal_id=NEW.entity_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Audit entity does not belong to project' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END; $$;
