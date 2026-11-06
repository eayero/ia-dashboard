ALTER TABLE project_counters DROP CONSTRAINT project_counters_kind_check;
ALTER TABLE project_counters ADD CONSTRAINT project_counters_kind_check CHECK(kind IN ('TASK','EVENT','REQ','ITER'));
CREATE TABLE iterations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  public_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 300),
  goal TEXT NOT NULL CHECK(length(trim(goal)) BETWEEN 1 AND 4000),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL CHECK(ends_on>=starts_on),
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id,id), UNIQUE(project_id,public_id),
  FOREIGN KEY(project_id,created_by) REFERENCES project_members(project_id,principal_id)
);
CREATE UNIQUE INDEX iteration_one_active ON iterations(project_id) WHERE status='ACTIVE';
ALTER TABLE requirements ADD COLUMN sprint_id UUID;
ALTER TABLE requirements ADD FOREIGN KEY(project_id,sprint_id) REFERENCES iterations(project_id,id);
ALTER TABLE work_items ADD COLUMN primary_requirement_id UUID;
ALTER TABLE work_items ADD CONSTRAINT task_primary_link FOREIGN KEY(project_id,primary_requirement_id,id) REFERENCES requirement_task_links(project_id,requirement_id,task_id) DEFERRABLE INITIALLY DEFERRED;
UPDATE work_items w SET primary_requirement_id=l.requirement_id FROM requirement_task_links l WHERE l.project_id=w.project_id AND l.task_id=w.id AND (SELECT count(*) FROM requirement_task_links x WHERE x.project_id=w.project_id AND x.task_id=w.id)=1;
-- Drain deferred link/coverage checks before later ALTER TABLE statements.
SET CONSTRAINTS task_primary_link,task_requires_requirement IMMEDIATE;
SET CONSTRAINTS task_primary_link,task_requires_requirement DEFERRED;
ALTER TABLE task_work_intervals ADD COLUMN requirement_id UUID;
ALTER TABLE task_work_intervals ADD COLUMN sprint_id UUID;
ALTER TABLE task_work_intervals ADD FOREIGN KEY(project_id,requirement_id) REFERENCES requirements(project_id,id);
ALTER TABLE task_work_intervals ADD FOREIGN KEY(project_id,sprint_id) REFERENCES iterations(project_id,id);
ALTER TABLE task_work_intervals DROP CONSTRAINT task_work_intervals_close_reason_check;
ALTER TABLE task_work_intervals ADD CHECK(close_reason IN ('PAUSED','CLAIM_ENDED','SESSION_ENDED','LEASE_EXPIRED','SPRINT_STOPPED','SPRINT_PREPARATION'));
CREATE INDEX work_requirement_history ON task_work_intervals(project_id,requirement_id,started_at);
ALTER TABLE audit_events ADD COLUMN channel TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(channel IN ('UNKNOWN','MCP','WEB','API'));
ALTER TABLE audit_events ADD COLUMN actor_identity JSONB;
CREATE FUNCTION authenticated_identity(actor UUID) RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('principalId',p.id,'kind',p.kind,'agentName',a.name,'ownerUserId',CASE WHEN p.kind='HUMAN' THEN u.principal_id ELSE a.owner_user_id END,'username',u.username,'ownerUsername',o.username)
  FROM principals p LEFT JOIN agent_profiles a ON a.principal_id=p.id LEFT JOIN local_users u ON u.principal_id=p.id LEFT JOIN local_users o ON o.principal_id=a.owner_user_id WHERE p.id=actor
$$;
CREATE FUNCTION snapshot_audit_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.actor_identity=authenticated_identity(NEW.actor_id); RETURN NEW; END; $$;
CREATE TRIGGER audit_identity_snapshot BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION snapshot_audit_identity();
ALTER TABLE work_items ADD COLUMN creator_identity JSONB;
ALTER TABLE requirements ADD COLUMN creator_identity JSONB;
CREATE FUNCTION protect_entity_creator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.creator_identity=authenticated_identity(NEW.created_by);
 ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.creator_identity IS DISTINCT FROM OLD.creator_identity THEN RAISE EXCEPTION 'Creator is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER task_creator BEFORE INSERT OR UPDATE ON work_items FOR EACH ROW EXECUTE FUNCTION protect_entity_creator();
CREATE TRIGGER requirement_creator BEFORE INSERT OR UPDATE ON requirements FOR EACH ROW EXECUTE FUNCTION protect_entity_creator();
ALTER TABLE audit_events DROP CONSTRAINT audit_events_entity_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_entity_type_check CHECK(entity_type IN ('TASK','SESSION','PRINCIPAL','REQUIREMENT','REPOSITORY','ITERATION'));
CREATE OR REPLACE FUNCTION validate_audit_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.entity_type='TASK' THEN PERFORM 1 FROM work_items WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='SESSION' THEN PERFORM 1 FROM agent_sessions WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='REQUIREMENT' THEN PERFORM 1 FROM requirements WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='REPOSITORY' THEN PERFORM 1 FROM repositories WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSIF NEW.entity_type='ITERATION' THEN PERFORM 1 FROM iterations WHERE project_id=NEW.project_id AND id=NEW.entity_id;
 ELSE PERFORM 1 FROM project_members WHERE project_id=NEW.project_id AND principal_id=NEW.entity_id; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Audit entity does not belong to project' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END; $$;

CREATE INDEX audit_entity_participation ON audit_events(project_id,entity_type,entity_id,seq);
