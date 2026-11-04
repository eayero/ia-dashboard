-- No silent backfill: existing orphan work must be explicitly associated first.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM work_items w WHERE NOT EXISTS (
    SELECT 1 FROM requirement_task_links l WHERE l.project_id=w.project_id AND l.task_id=w.id
  )) THEN RAISE EXCEPTION 'Associate every existing task with a requirement before migration 010'; END IF;
END; $$;

CREATE FUNCTION enforce_task_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p UUID; t UUID;
BEGIN
  IF TG_TABLE_NAME='work_items' THEN p=NEW.project_id; t=NEW.id;
  ELSE p=OLD.project_id; t=OLD.task_id; END IF;
  PERFORM 1 FROM work_items WHERE project_id=p AND id=t FOR UPDATE;
  IF FOUND AND NOT EXISTS (SELECT 1 FROM requirement_task_links WHERE project_id=p AND task_id=t) THEN
    RAISE EXCEPTION 'TASK_REQUIREMENT_REQUIRED' USING ERRCODE='23514',CONSTRAINT='task_requires_requirement';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER task_requires_requirement
AFTER INSERT OR UPDATE ON work_items DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_task_requirement();
CREATE TRIGGER task_requirements_no_truncate BEFORE TRUNCATE ON requirement_task_links
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
CREATE CONSTRAINT TRIGGER last_task_requirement
AFTER DELETE OR UPDATE ON requirement_task_links DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_task_requirement();
