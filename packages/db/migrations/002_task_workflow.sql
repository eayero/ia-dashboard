ALTER TABLE work_items
  ADD COLUMN work_type TEXT NOT NULL DEFAULT 'OTHER' CHECK(work_type IN ('CODE','OTHER')),
  ADD COLUMN work_summary TEXT NOT NULL DEFAULT '',
  ADD COLUMN manual_blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN impact_pending BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE principals ADD CONSTRAINT principal_id_kind UNIQUE(id,kind);

CREATE TABLE repositories (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  url TEXT NOT NULL CHECK(url LIKE 'https://%'),
  UNIQUE(project_id,id)
);
CREATE TABLE evidence (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  work_revision INTEGER NOT NULL CHECK(work_revision>0),
  kind TEXT NOT NULL CHECK(kind IN ('CODE','TEST','REVIEW','OTHER')),
  url TEXT NOT NULL CHECK(url LIKE 'https://%'),
  repository_id UUID,
  commit_sha TEXT,
  test_result JSONB,
  declared_by UUID NOT NULL,
  accepted_by UUID,
  accepted_kind TEXT NOT NULL DEFAULT 'HUMAN' CHECK(accepted_kind='HUMAN'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id,task_id,id),
  CHECK ((accepted_by IS NULL) = (accepted_at IS NULL)),
  CHECK (kind NOT IN ('CODE','TEST') OR (repository_id IS NOT NULL AND commit_sha IS NOT NULL)),
  CHECK (kind <> 'TEST' OR (test_result IS NOT NULL AND test_result ? 'outcome' AND test_result->>'outcome' IN ('PASS','FAIL'))),
  CHECK (commit_sha IS NULL OR commit_sha ~ '^([a-f0-9]{40}|[a-f0-9]{64})$'),
  FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
  FOREIGN KEY(project_id,repository_id) REFERENCES repositories(project_id,id),
  FOREIGN KEY(project_id,declared_by) REFERENCES project_members(project_id,principal_id),
  FOREIGN KEY(project_id,accepted_by) REFERENCES project_members(project_id,principal_id),
  FOREIGN KEY(accepted_by,accepted_kind) REFERENCES principals(id,kind)
);
CREATE TABLE evidence_criteria (
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  evidence_id UUID NOT NULL,
  criterion_id TEXT NOT NULL,
  PRIMARY KEY(project_id,task_id,evidence_id,criterion_id),
  FOREIGN KEY(project_id,task_id,evidence_id) REFERENCES evidence(project_id,task_id,id)
);
CREATE TABLE approvals (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  work_revision INTEGER NOT NULL CHECK(work_revision>0),
  kind TEXT NOT NULL CHECK(kind IN ('REVIEW','QA','CLOSURE')),
  principal_id UUID NOT NULL,
  principal_kind TEXT NOT NULL DEFAULT 'HUMAN' CHECK(principal_kind='HUMAN'),
  approved_roles TEXT[] NOT NULL CHECK(approved_roles && ARRAY['OWNER','ADMIN','REVIEWER']::TEXT[]),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  invalidated_at TIMESTAMPTZ,
  FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
  FOREIGN KEY(project_id,principal_id) REFERENCES project_members(project_id,principal_id),
  FOREIGN KEY(principal_id,principal_kind) REFERENCES principals(id,kind)
);
CREATE UNIQUE INDEX one_active_approval ON approvals(project_id,task_id,work_revision,kind) WHERE invalidated_at IS NULL;
CREATE TABLE task_dependencies (
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  depends_on UUID NOT NULL,
  PRIMARY KEY(project_id,task_id,depends_on),
  CHECK(task_id<>depends_on),
  FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
  FOREIGN KEY(project_id,depends_on) REFERENCES work_items(project_id,id)
);
CREATE INDEX dependency_reverse ON task_dependencies(project_id,depends_on,task_id);
CREATE TABLE task_alerts (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  depends_on UUID NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,task_id) REFERENCES work_items(project_id,id),
  FOREIGN KEY(project_id,depends_on) REFERENCES work_items(project_id,id)
);
