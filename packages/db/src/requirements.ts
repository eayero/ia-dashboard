import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DomainError, type Actor } from '@acc/domain';
import {
  createRequirementSchema,
  reviseRequirementSchema,
  approveRequirementSchema,
  linkRequirementSchema,
  evaluateRequirementImpactSchema,
} from '@acc/contracts';

export const requirementSchemas = {
  create: createRequirementSchema,
  revise: reviseRequirementSchema,
  approve: approveRequirementSchema,
  link: linkRequirementSchema,
  evaluate: evaluateRequirementImpactSchema,
};
export type RequirementOperation = keyof typeof requirementSchemas;
type Requirement = {
  id: string;
  public_id: string;
  version: number;
  current_revision: number;
  approved_revision: number | null;
};
type Environment = {
  client: pg.PoolClient;
  projectId: string;
  principalId: string;
  actor: Actor;
  event: (
    id: string,
    action: string,
    payload: Record<string, unknown>,
    type?: 'TASK' | 'REQUIREMENT',
  ) => Promise<string>;
  counter: () => Promise<string>;
};
export type RequirementResult = {
  id: string;
  publicId: string;
  version: number;
  revision: number;
  approvedRevision: number | null;
  projectSeq: string;
  taskVersion?: number;
};
export async function requirementCommand(
  env: Environment,
  operation: RequirementOperation,
  id: string | null,
  payload: unknown,
): Promise<RequirementResult> {
  const { client, projectId, principalId, actor } = env;
  const parsed = requirementSchemas[operation].parse(payload);
  // Each branch reparses to retain its exact discriminated contract at runtime and in TS.
  if (operation === 'create') {
    const input = createRequirementSchema.parse(parsed);
    if (input.externalRef) {
      const prior = await client.query<Requirement>(
        'SELECT * FROM requirements WHERE project_id=$1 AND external_ref=$2',
        [projectId, input.externalRef],
      );
      if (prior.rows[0]) {
        const r = prior.rows[0];
        const seq = await client.query<{ value: string }>(
          "SELECT value FROM project_counters WHERE project_id=$1 AND kind='EVENT'",
          [projectId],
        );
        return {
          id: r.id,
          publicId: r.public_id,
          version: r.version,
          revision: r.current_revision,
          approvedRevision: r.approved_revision,
          projectSeq: seq.rows[0]?.value ?? '0',
        };
      }
    }
    const reqId = randomUUID(),
      publicId = `REQ-${await env.counter()}`;
    await client.query(
      'INSERT INTO requirements(id,project_id,public_id,external_ref,created_by) VALUES ($1,$2,$3,$4,$5)',
      [reqId, projectId, publicId, input.externalRef ?? null, principalId],
    );
    await client.query(
      "INSERT INTO requirement_revisions(project_id,requirement_id,revision,type,title,description,reason,status,created_by) VALUES ($1,$2,1,$3,$4,$5,'Initial proposal','DRAFT',$6)",
      [projectId, reqId, input.type, input.title, input.description, principalId],
    );
    const projectSeq = await env.event(reqId, 'requirement.created', {
      publicId,
      version: 1,
      revision: 1,
    });
    return { id: reqId, publicId, version: 1, revision: 1, approvedRevision: null, projectSeq };
  }
  const result = await client.query<Requirement>(
    'SELECT * FROM requirements WHERE project_id=$1 AND id=$2 FOR UPDATE',
    [projectId, id],
  );
  const r = result.rows[0];
  if (!r) throw new DomainError('REQUIREMENT_NOT_FOUND');
  if (!('expectedVersion' in parsed) || r.version !== parsed.expectedVersion)
    throw new DomainError('VERSION_CONFLICT');
  const human = () => {
    if (
      actor.kind !== 'HUMAN' ||
      !actor.roles.some((v) => ['OWNER', 'ADMIN', 'MANAGER'].includes(v))
    )
      throw new DomainError('FORBIDDEN');
  };
  let revision = r.current_revision,
    approvedRevision = r.approved_revision,
    taskVersion: number | undefined;
  if (operation === 'revise') {
    const input = reviseRequirementSchema.parse(parsed);
    await client.query(
      "UPDATE requirement_revisions SET status='SUPERSEDED' WHERE project_id=$1 AND requirement_id=$2 AND status='DRAFT'",
      [projectId, id],
    );
    revision++;
    await client.query(
      "INSERT INTO requirement_revisions(project_id,requirement_id,revision,type,title,description,reason,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8)",
      [
        projectId,
        id,
        revision,
        input.type,
        input.title,
        input.description,
        input.reason,
        principalId,
      ],
    );
    await client.query(
      'UPDATE requirements SET current_revision=$3 WHERE project_id=$1 AND id=$2',
      [projectId, id, revision],
    );
  } else if (operation === 'approve') {
    human();
    const input = approveRequirementSchema.parse(parsed);
    if (input.revision !== r.current_revision || input.revision === r.approved_revision)
      throw new DomainError('REQUIREMENT_REVISION_CONFLICT');
    await client.query(
      "UPDATE requirement_revisions SET status='SUPERSEDED' WHERE project_id=$1 AND requirement_id=$2 AND status='APPROVED'",
      [projectId, id],
    );
    await client.query(
      "UPDATE requirement_revisions SET status='APPROVED',approved_by=$3,approved_at=clock_timestamp() WHERE project_id=$1 AND requirement_id=$2 AND revision=$4 AND status='DRAFT'",
      [projectId, id, principalId, input.revision],
    );
    approvedRevision = input.revision;
    await client.query(
      'UPDATE requirements SET approved_revision=$3 WHERE project_id=$1 AND id=$2',
      [projectId, id, approvedRevision],
    );
    const tasks = await client.query<{ id: string; version: number; status: string }>(
      'SELECT w.id,w.version,w.status FROM work_items w JOIN requirement_task_links l ON l.project_id=w.project_id AND l.task_id=w.id WHERE l.project_id=$1 AND l.requirement_id=$2 ORDER BY w.id FOR UPDATE OF w',
      [projectId, id],
    );
    for (const task of tasks.rows) {
      await client.query(
        'UPDATE work_items SET impact_pending=true,version=version+1 WHERE id=$1',
        [task.id],
      );
      if (task.status === 'DONE')
        await client.query(
          'INSERT INTO requirement_impact_alerts(id,project_id,requirement_id,task_id,revision) VALUES ($1,$2,$3,$4,$5)',
          [randomUUID(), projectId, id, task.id, approvedRevision],
        );
      await env.event(
        task.id,
        'task.requirementImpactPending',
        { requirementId: id, revision: approvedRevision, version: task.version + 1 },
        'TASK',
      );
    }
  } else {
    human();
    const input =
      operation === 'link'
        ? linkRequirementSchema.parse(parsed)
        : evaluateRequirementImpactSchema.parse(parsed);
    const locked = await client.query<{ version: number; status: string }>(
      'SELECT version,status FROM work_items WHERE project_id=$1 AND id=$2 FOR UPDATE',
      [projectId, input.taskId],
    );
    const task = locked.rows[0];
    if (!task) throw new DomainError('TASK_NOT_FOUND');
    if (task.version !== input.taskVersion) throw new DomainError('VERSION_CONFLICT');
    if (operation === 'link') {
      const link = linkRequirementSchema.parse(input);
      if (link.operation === 'ADD') {
        const added = await client.query(
          'INSERT INTO requirement_task_links(project_id,requirement_id,task_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING task_id',
          [projectId, id, link.taskId],
        );
        if (!added.rowCount) throw new DomainError('REQUIREMENT_LINK_EXISTS');
        if (task.status === 'DONE' && approvedRevision !== null)
          await client.query(
            'INSERT INTO requirement_impact_alerts(id,project_id,requirement_id,task_id,revision) VALUES ($1,$2,$3,$4,$5)',
            [randomUUID(), projectId, id, link.taskId, approvedRevision],
          );
      } else {
        const remaining = await client.query(
          'SELECT 1 FROM requirement_task_links WHERE project_id=$1 AND task_id=$2 AND requirement_id<>$3 LIMIT 1',
          [projectId, link.taskId, id],
        );
        if (!remaining.rowCount) throw new DomainError('TASK_REQUIREMENT_REQUIRED');
        const removed = await client.query(
          'DELETE FROM requirement_task_links WHERE project_id=$1 AND requirement_id=$2 AND task_id=$3 RETURNING task_id',
          [projectId, id, link.taskId],
        );
        if (!removed.rowCount) throw new DomainError('REQUIREMENT_LINK_NOT_FOUND');
      }
    } else {
      const review = evaluateRequirementImpactSchema.parse(input);
      if (review.revision !== approvedRevision)
        throw new DomainError('REQUIREMENT_REVISION_CONFLICT');
      const updated = await client.query(
        'UPDATE requirement_task_links SET evaluated_revision=$4 WHERE project_id=$1 AND requirement_id=$2 AND task_id=$3 RETURNING task_id',
        [projectId, id, review.taskId, review.revision],
      );
      if (!updated.rowCount) throw new DomainError('REQUIREMENT_LINK_NOT_FOUND');
      await client.query(
        'INSERT INTO requirement_impact_reviews(id,project_id,requirement_id,task_id,revision,reason,principal_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), projectId, id, review.taskId, review.revision, review.reason, principalId],
      );
    }
    await client.query(
      'UPDATE work_items w SET version=version+1,impact_pending=EXISTS(SELECT 1 FROM requirement_task_links l JOIN requirements r ON r.project_id=l.project_id AND r.id=l.requirement_id WHERE l.project_id=w.project_id AND l.task_id=w.id AND (r.approved_revision IS NULL OR l.evaluated_revision IS DISTINCT FROM r.approved_revision)) WHERE w.project_id=$1 AND w.id=$2',
      [projectId, input.taskId],
    );
    taskVersion = task.version + 1;
    await env.event(
      input.taskId,
      operation === 'link' ? 'task.requirementLinked' : 'task.requirementImpactReviewed',
      { requirementId: id, version: taskVersion, ...input },
      'TASK',
    );
  }
  await client.query('UPDATE requirements SET version=version+1 WHERE project_id=$1 AND id=$2', [
    projectId,
    id,
  ]);
  const projectSeq = await env.event(r.id, `requirement.${operation}`, {
    ...parsed,
    version: r.version + 1,
    revision,
    approvedRevision,
  });
  return {
    id: r.id,
    publicId: r.public_id,
    version: r.version + 1,
    revision,
    approvedRevision,
    projectSeq,
    ...(taskVersion === undefined ? {} : { taskVersion }),
  };
}
