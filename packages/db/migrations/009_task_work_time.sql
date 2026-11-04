CREATE TABLE task_work_intervals (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  principal_id UUID NOT NULL,
  principal_kind TEXT NOT NULL DEFAULT 'AGENT' CHECK(principal_kind='AGENT'),
  session_id UUID NOT NULL,
  fencing_token BIGINT NOT NULL CHECK(fencing_token>0),
  work_revision INTEGER NOT NULL DEFAULT 1 CHECK(work_revision>0),
  agent_name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES principals(id),
  started_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  valid_until TIMESTAMPTZ(3) NOT NULL,
  ended_at TIMESTAMPTZ(3),
  close_reason TEXT CHECK(close_reason IN ('PAUSED','CLAIM_ENDED','SESSION_ENDED','LEASE_EXPIRED')),
  FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
  FOREIGN KEY(project_id,principal_id) REFERENCES project_members(project_id,principal_id),
  FOREIGN KEY(principal_id,principal_kind) REFERENCES principals(id,kind),
  FOREIGN KEY(project_id,principal_id,session_id) REFERENCES agent_sessions(project_id,principal_id,id),
  CHECK(valid_until>=started_at),
  CHECK(ended_at IS NULL OR (ended_at>=started_at AND ended_at<=valid_until)),
  CHECK((ended_at IS NULL)=(close_reason IS NULL))
);
CREATE UNIQUE INDEX task_work_one_running ON task_work_intervals(project_id,principal_id) WHERE ended_at IS NULL;
CREATE INDEX task_work_history ON task_work_intervals(project_id,task_id,started_at,id);
CREATE FUNCTION protect_task_work_interval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Work history is immutable' USING ERRCODE='55000'; END IF;
  IF OLD.ended_at IS NOT NULL
    OR (to_jsonb(NEW)-ARRAY['valid_until','ended_at','close_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['valid_until','ended_at','close_reason'])
    OR (NEW.ended_at IS NULL AND NEW.valid_until<OLD.started_at) THEN
    RAISE EXCEPTION 'Work history is immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.ended_at IS NULL AND OLD.valid_until<=clock_timestamp() THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER task_work_immutable BEFORE UPDATE OR DELETE ON task_work_intervals FOR EACH ROW EXECUTE FUNCTION protect_task_work_interval();
CREATE TRIGGER task_work_no_truncate BEFORE TRUNCATE ON task_work_intervals FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_change();
CREATE FUNCTION sync_work_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked OR NEW.fencing_token<>OLD.fencing_token OR NEW.principal_id<>OLD.principal_id OR NEW.session_id<>OLD.session_id THEN
    UPDATE task_work_intervals SET ended_at=GREATEST(started_at,LEAST(clock_timestamp()::timestamptz(3),valid_until)),close_reason=CASE WHEN valid_until<=clock_timestamp() THEN 'LEASE_EXPIRED' ELSE 'CLAIM_ENDED' END
    WHERE project_id=OLD.project_id AND task_id=OLD.task_id AND principal_id=OLD.principal_id AND session_id=OLD.session_id AND fencing_token=OLD.fencing_token AND ended_at IS NULL;
  ELSE
    UPDATE task_work_intervals w SET valid_until=GREATEST(w.started_at,LEAST(NEW.expires_at,s.expires_at)::timestamptz(3))
    FROM agent_sessions s WHERE w.project_id=OLD.project_id AND w.task_id=OLD.task_id AND w.principal_id=OLD.principal_id AND w.session_id=OLD.session_id AND w.fencing_token=OLD.fencing_token AND s.id=w.session_id AND w.ended_at IS NULL AND w.valid_until>clock_timestamp() AND s.ended_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER work_claim_lifecycle AFTER UPDATE ON task_claims FOR EACH ROW EXECUTE FUNCTION sync_work_claim();
CREATE FUNCTION sync_work_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ended_at IS NOT NULL THEN
    UPDATE task_work_intervals SET ended_at=GREATEST(started_at,LEAST(clock_timestamp()::timestamptz(3),valid_until,OLD.expires_at)),close_reason=CASE WHEN valid_until<=clock_timestamp() THEN 'LEASE_EXPIRED' ELSE 'SESSION_ENDED' END
    WHERE session_id=OLD.id AND ended_at IS NULL;
  ELSE
    UPDATE task_work_intervals w SET valid_until=GREATEST(w.started_at,LEAST(NEW.expires_at,c.expires_at)::timestamptz(3))
    FROM task_claims c WHERE w.session_id=OLD.id AND w.project_id=c.project_id AND w.task_id=c.task_id AND w.session_id=c.session_id AND w.principal_id=c.principal_id AND w.fencing_token=c.fencing_token AND NOT c.revoked AND w.ended_at IS NULL AND w.valid_until>clock_timestamp();
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER work_session_lifecycle AFTER UPDATE ON agent_sessions FOR EACH ROW EXECUTE FUNCTION sync_work_session();
