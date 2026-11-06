ALTER TABLE project_counters DROP CONSTRAINT project_counters_kind_check;
ALTER TABLE project_counters ADD CONSTRAINT project_counters_kind_check CHECK(kind IN ('TASK','EVENT','REQ','ITER','Q','DEC'));

CREATE TABLE questions (
 id UUID PRIMARY KEY,project_id UUID NOT NULL REFERENCES projects(id),public_id TEXT NOT NULL,
 external_ref TEXT,title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),description TEXT NOT NULL,
 priority TEXT NOT NULL CHECK(priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED','CANCELLED')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),accepted_answer_id UUID,
 created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),creator_identity JSONB,
 UNIQUE(project_id,id),UNIQUE(project_id,public_id),UNIQUE(project_id,external_ref),
 FOREIGN KEY(project_id,created_by) REFERENCES project_members(project_id,principal_id),
 CHECK((status='RESOLVED')=(accepted_answer_id IS NOT NULL))
);
CREATE TABLE question_answers (
 id UUID PRIMARY KEY,project_id UUID NOT NULL,question_id UUID NOT NULL,text TEXT NOT NULL CHECK(length(trim(text)) BETWEEN 1 AND 8000),
 created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),creator_identity JSONB,
 UNIQUE(project_id,question_id,id),FOREIGN KEY(project_id,question_id) REFERENCES questions(project_id,id),
 FOREIGN KEY(project_id,created_by) REFERENCES project_members(project_id,principal_id)
);
ALTER TABLE questions ADD FOREIGN KEY(project_id,id,accepted_answer_id) REFERENCES question_answers(project_id,question_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE question_resolutions (
 id UUID PRIMARY KEY,project_id UUID NOT NULL,question_id UUID NOT NULL,answer_id UUID,
 action TEXT NOT NULL CHECK(action IN ('RESOLVE','REOPEN','CANCEL')),reason TEXT NOT NULL,
 principal_id UUID NOT NULL,principal_kind TEXT GENERATED ALWAYS AS ('HUMAN') STORED,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,question_id) REFERENCES questions(project_id,id),
 FOREIGN KEY(project_id,question_id,answer_id) REFERENCES question_answers(project_id,question_id,id),
 FOREIGN KEY(project_id,principal_id) REFERENCES project_members(project_id,principal_id),
 FOREIGN KEY(principal_id,principal_kind) REFERENCES principals(id,kind),
 CHECK((action='RESOLVE')=(answer_id IS NOT NULL))
);
CREATE TABLE question_task_links (
 project_id UUID NOT NULL,question_id UUID NOT NULL,task_id UUID NOT NULL,hard BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY(project_id,question_id,task_id),FOREIGN KEY(project_id,question_id) REFERENCES questions(project_id,id),
 FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id)
);
CREATE INDEX question_task_blocking ON question_task_links(project_id,task_id) WHERE hard;
CREATE TABLE question_requirement_links (
 project_id UUID NOT NULL,question_id UUID NOT NULL,requirement_id UUID NOT NULL,
 PRIMARY KEY(project_id,question_id,requirement_id),FOREIGN KEY(project_id,question_id) REFERENCES questions(project_id,id),
 FOREIGN KEY(project_id,requirement_id) REFERENCES requirements(project_id,id)
);
CREATE TABLE question_task_alerts (
 id UUID PRIMARY KEY,project_id UUID NOT NULL,question_id UUID NOT NULL,task_id UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,question_id) REFERENCES questions(project_id,id),FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id)
);
CREATE TABLE decisions (
 id UUID PRIMARY KEY,project_id UUID NOT NULL REFERENCES projects(id),public_id TEXT NOT NULL,external_ref TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),current_revision INTEGER NOT NULL DEFAULT 1 CHECK(current_revision>0),approved_revision INTEGER,
 created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),creator_identity JSONB,
 UNIQUE(project_id,id),UNIQUE(project_id,public_id),UNIQUE(project_id,external_ref),
 FOREIGN KEY(project_id,created_by) REFERENCES project_members(project_id,principal_id)
);
CREATE TABLE decision_revisions (
 project_id UUID NOT NULL,decision_id UUID NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 title TEXT NOT NULL,context TEXT NOT NULL,alternatives JSONB NOT NULL CHECK(jsonb_typeof(alternatives)='array' AND jsonb_array_length(alternatives)>=2),choice TEXT NOT NULL,rationale TEXT NOT NULL,reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('DRAFT','APPROVED','SUPERSEDED')),created_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),approved_by UUID,approved_kind TEXT GENERATED ALWAYS AS ('HUMAN') STORED,approved_at TIMESTAMPTZ,
 PRIMARY KEY(project_id,decision_id,revision),FOREIGN KEY(project_id,decision_id) REFERENCES decisions(project_id,id),
 FOREIGN KEY(project_id,created_by) REFERENCES project_members(project_id,principal_id),FOREIGN KEY(project_id,approved_by) REFERENCES project_members(project_id,principal_id),
 FOREIGN KEY(approved_by,approved_kind) REFERENCES principals(id,kind),CHECK(alternatives ? choice),CHECK((status='DRAFT' AND approved_by IS NULL AND approved_at IS NULL) OR (status IN ('APPROVED','SUPERSEDED') AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE decisions ADD FOREIGN KEY(project_id,id,current_revision) REFERENCES decision_revisions(project_id,decision_id,revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE decisions ADD FOREIGN KEY(project_id,id,approved_revision) REFERENCES decision_revisions(project_id,decision_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX decision_one_approved ON decision_revisions(project_id,decision_id) WHERE status='APPROVED';
CREATE TABLE decision_task_links (
 project_id UUID NOT NULL,decision_id UUID NOT NULL,task_id UUID NOT NULL,evaluated_revision INTEGER,
 PRIMARY KEY(project_id,decision_id,task_id),FOREIGN KEY(project_id,decision_id) REFERENCES decisions(project_id,id),
 FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
 FOREIGN KEY(project_id,decision_id,evaluated_revision) REFERENCES decision_revisions(project_id,decision_id,revision)
);
CREATE TABLE decision_requirement_links (
 project_id UUID NOT NULL,decision_id UUID NOT NULL,requirement_id UUID NOT NULL,
 PRIMARY KEY(project_id,decision_id,requirement_id),FOREIGN KEY(project_id,decision_id) REFERENCES decisions(project_id,id),
 FOREIGN KEY(project_id,requirement_id) REFERENCES requirements(project_id,id)
);
CREATE TABLE decision_question_links (
 project_id UUID NOT NULL,decision_id UUID NOT NULL,question_id UUID NOT NULL,
 PRIMARY KEY(project_id,decision_id,question_id),FOREIGN KEY(project_id,decision_id) REFERENCES decisions(project_id,id),
 FOREIGN KEY(project_id,question_id) REFERENCES questions(project_id,id)
);
CREATE TABLE decision_impact_reviews (
 id UUID PRIMARY KEY,project_id UUID NOT NULL,decision_id UUID NOT NULL,task_id UUID NOT NULL,revision INTEGER NOT NULL,reason TEXT NOT NULL,
 principal_id UUID NOT NULL,principal_kind TEXT GENERATED ALWAYS AS ('HUMAN') STORED,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
 FOREIGN KEY(project_id,decision_id,revision) REFERENCES decision_revisions(project_id,decision_id,revision),
 FOREIGN KEY(project_id,principal_id) REFERENCES project_members(project_id,principal_id),FOREIGN KEY(principal_id,principal_kind) REFERENCES principals(id,kind)
);
CREATE TABLE decision_impact_alerts (
 id UUID PRIMARY KEY,project_id UUID NOT NULL,decision_id UUID NOT NULL,task_id UUID NOT NULL,revision INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),FOREIGN KEY(project_id,decision_id,revision) REFERENCES decision_revisions(project_id,decision_id,revision)
);
CREATE FUNCTION protect_decision_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'status'-'approved_by'-'approved_kind'-'approved_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'approved_by'-'approved_kind'-'approved_at') OR NOT ((OLD.status='DRAFT' AND NEW.status='APPROVED') OR (OLD.status='APPROVED' AND NEW.status='SUPERSEDED' AND NEW.approved_by=OLD.approved_by AND NEW.approved_at=OLD.approved_at)) THEN
 RAISE EXCEPTION 'Decision revision is immutable' USING ERRCODE='55000'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER decision_revision_immutable BEFORE UPDATE OR DELETE ON decision_revisions FOR EACH ROW EXECUTE FUNCTION protect_decision_revision();
CREATE TRIGGER decision_revision_no_truncate BEFORE TRUNCATE ON decision_revisions FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
CREATE TRIGGER question_creator BEFORE INSERT OR UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION protect_entity_creator();
CREATE TRIGGER answer_creator BEFORE INSERT ON question_answers FOR EACH ROW EXECUTE FUNCTION protect_entity_creator();
CREATE TRIGGER decision_creator BEFORE INSERT OR UPDATE ON decisions FOR EACH ROW EXECUTE FUNCTION protect_entity_creator();
DO $$ DECLARE t TEXT; BEGIN FOREACH t IN ARRAY ARRAY['question_answers','question_resolutions','question_task_alerts','decision_impact_reviews','decision_impact_alerts'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_audit_change()',t);
 EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change()',t);
END LOOP; END; $$;
ALTER TABLE audit_events DROP CONSTRAINT audit_events_entity_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_entity_type_check CHECK(entity_type IN ('TASK','SESSION','PRINCIPAL','REQUIREMENT','REPOSITORY','ITERATION','QUESTION','DECISION'));
CREATE OR REPLACE FUNCTION validate_audit_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.entity_type='TASK' THEN PERFORM 1 FROM work_items WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='SESSION' THEN PERFORM 1 FROM agent_sessions WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='REQUIREMENT' THEN PERFORM 1 FROM requirements WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='REPOSITORY' THEN PERFORM 1 FROM repositories WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='ITERATION' THEN PERFORM 1 FROM iterations WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='QUESTION' THEN PERFORM 1 FROM questions WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='DECISION' THEN PERFORM 1 FROM decisions WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSE PERFORM 1 FROM project_members WHERE project_id=NEW.project_id AND principal_id=NEW.entity_id; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Audit entity does not belong to project' USING ERRCODE='23503'; END IF; RETURN NEW;
END; $$;
