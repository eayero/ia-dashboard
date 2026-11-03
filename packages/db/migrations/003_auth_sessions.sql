CREATE TABLE oidc_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  principal_id UUID NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('HUMAN','AGENT')),
  PRIMARY KEY(issuer,subject),
  FOREIGN KEY(principal_id,kind) REFERENCES principals(id,kind)
);
CREATE TABLE http_sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX http_session_expiry ON http_sessions(expire);
ALTER TABLE project_members ADD COLUMN active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE agent_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_project_id_entity_id_fkey;
ALTER TABLE audit_events ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'TASK' CHECK(entity_type IN ('TASK','SESSION','PRINCIPAL'));
CREATE FUNCTION validate_audit_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_type='TASK' THEN
    PERFORM 1 FROM work_items WHERE project_id=NEW.project_id AND id=NEW.entity_id;
  ELSIF NEW.entity_type='SESSION' THEN
    PERFORM 1 FROM agent_sessions WHERE project_id=NEW.project_id AND id=NEW.entity_id;
  ELSE
    PERFORM 1 FROM project_members WHERE project_id=NEW.project_id AND principal_id=NEW.entity_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit entity does not belong to project' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_entity_project BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION validate_audit_entity();
