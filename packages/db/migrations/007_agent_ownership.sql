CREATE TABLE agent_profiles (
  principal_id UUID PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'AGENT' CHECK(kind='AGENT'),
  owner_user_id UUID NOT NULL REFERENCES local_users(principal_id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(principal_id,kind) REFERENCES principals(id,kind)
);
CREATE INDEX agents_by_owner ON agent_profiles(owner_user_id,principal_id);

-- Preserve existing identities/tokens. Never guess when legacy ownership is ambiguous.
CREATE TEMP TABLE acc_agent_owner_backfill ON COMMIT DROP AS
SELECT p.id AS principal_id,
  COALESCE(
    (SELECT e.actor_id FROM security_events e JOIN local_users u ON u.principal_id=e.actor_id
     WHERE e.target_id=p.id AND e.action='credential.created' ORDER BY e.occurred_at,e.id LIMIT 1),
    (SELECT CASE WHEN count(DISTINCT u.principal_id)=1 THEN min(u.principal_id::text)::uuid END
     FROM project_members a JOIN project_members m ON m.project_id=a.project_id
     JOIN local_users u ON u.principal_id=m.principal_id
     WHERE a.principal_id=p.id AND 'OWNER'=ANY(m.roles))
  ) AS owner_user_id,
  COALESCE((SELECT regexp_replace(c.label,':(api|mcp)$','') FROM agent_credentials c
            WHERE c.principal_id=p.id ORDER BY c.created_at,c.id LIMIT 1),'Agente '||left(p.id::text,8)) AS name
FROM principals p WHERE p.kind='AGENT';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM acc_agent_owner_backfill WHERE owner_user_id IS NULL) THEN
    RAISE EXCEPTION 'Legacy agent ownership is ambiguous; assign explicit human owners before migration';
  END IF;
END $$;
INSERT INTO agent_profiles(principal_id,owner_user_id,name)
SELECT principal_id,owner_user_id,name FROM acc_agent_owner_backfill;
ALTER TABLE agent_credentials ADD CONSTRAINT credential_agent_profile
  FOREIGN KEY(principal_id) REFERENCES agent_profiles(principal_id);

CREATE FUNCTION agent_owner_project_access(agent_id UUID,project UUID,writes BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM agent_profiles a JOIN principals p ON p.id=a.owner_user_id
    JOIN project_members m ON m.principal_id=a.owner_user_id AND m.project_id=project
    WHERE a.principal_id=agent_id AND NOT p.disabled AND m.active
      AND (NOT writes OR m.roles && ARRAY['OWNER','ADMIN','MANAGER','REVIEWER']::text[])
  )
$$;

ALTER TABLE audit_events ADD COLUMN actor_user_id UUID REFERENCES local_users(principal_id);
CREATE FUNCTION attribute_agent_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM principals WHERE id=NEW.actor_id AND kind='AGENT') THEN
    SELECT owner_user_id INTO NEW.actor_user_id FROM agent_profiles WHERE principal_id=NEW.actor_id;
    IF NEW.actor_user_id IS NULL THEN
      RAISE EXCEPTION 'Agent audit actor must have a human owner' USING ERRCODE='23503';
    END IF;
  ELSE
    SELECT principal_id INTO NEW.actor_user_id FROM local_users WHERE principal_id=NEW.actor_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_agent_owner BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION attribute_agent_audit();
