import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DomainError } from '@acc/domain';
import {
  createIterationSchema,
  updateIterationSchema,
  transitionIterationSchema,
  assignRequirementSprintSchema,
  assignPrimaryRequirementSchema,
  prepareSprintExecutionSchema,
} from '@acc/contracts';

export const planningSchemas = {
  create: createIterationSchema,
  update: updateIterationSchema,
  transition: transitionIterationSchema,
  assignSprint: assignRequirementSprintSchema,
  assignPrimary: assignPrimaryRequirementSchema,
  prepare: prepareSprintExecutionSchema,
};
export type PlanningOperation = keyof typeof planningSchemas;
type Environment = {
  client: pg.PoolClient;
  projectId: string;
  principalId: string;
  counter: () => Promise<string>;
  event: (
    id: string,
    action: string,
    data: Record<string, unknown>,
    type: 'TASK' | 'REQUIREMENT' | 'ITERATION',
  ) => Promise<string>;
};
export async function taskPlanning(client: pg.PoolClient, projectId: string, taskId: string) {
  const found = await client.query<{
    primaryRequirementId: string | null;
    sprintId: string | null;
    sprintStatus: string | null;
    sprintName: string | null;
    sprintPublicId: string | null;
  }>(
    'SELECT w.primary_requirement_id AS "primaryRequirementId",r.sprint_id AS "sprintId",i.status AS "sprintStatus",i.name AS "sprintName",i.public_id AS "sprintPublicId" FROM work_items w LEFT JOIN requirements r ON r.project_id=w.project_id AND r.id=w.primary_requirement_id LEFT JOIN iterations i ON i.project_id=r.project_id AND i.id=r.sprint_id WHERE w.project_id=$1 AND w.id=$2',
    [projectId, taskId],
  );
  const value = found.rows[0];
  if (!value) throw new DomainError('TASK_NOT_FOUND');
  return {
    ...value,
    executionBlock: !value.primaryRequirementId
      ? 'PRIMARY_REQUIREMENT_REQUIRED'
      : !value.sprintId
        ? 'SPRINT_REQUIRED'
        : value.sprintStatus !== 'ACTIVE'
          ? 'SPRINT_NOT_ACTIVE'
          : null,
  };
}
export async function assertTaskSprintActive(
  client: pg.PoolClient,
  projectId: string,
  taskId: string,
) {
  const planning = await taskPlanning(client, projectId, taskId);
  if (planning.executionBlock) throw new DomainError(planning.executionBlock);
  return planning;
}
async function inactiveWork(client: pg.PoolClient, projectId: string, ids: string[]) {
  const active = await client.query(
    `SELECT 1 FROM task_claims c JOIN agent_sessions s ON s.id=c.session_id WHERE c.project_id=$1 AND c.task_id=ANY($2::uuid[]) AND NOT c.revoked AND c.expires_at>clock_timestamp() AND s.ended_at IS NULL AND s.expires_at>clock_timestamp()
    UNION ALL SELECT 1 FROM task_work_intervals WHERE project_id=$1 AND task_id=ANY($2::uuid[]) AND ended_at IS NULL AND valid_until>clock_timestamp() LIMIT 1`,
    [projectId, ids],
  );
  if (active.rowCount) throw new DomainError('ASSIGNMENT_WORK_ACTIVE');
}
async function stopWork(
  env: Environment,
  ids: string[],
  reason: 'SPRINT_STOPPED' | 'SPRINT_PREPARATION',
  sprintId: string | null,
) {
  const { client, projectId } = env;
  const instant = (
    await client.query<{ now: Date }>('SELECT clock_timestamp()::timestamptz(3) AS now')
  ).rows[0]!.now;
  await client.query(
    `UPDATE task_work_intervals SET ended_at=GREATEST(started_at,LEAST($3::timestamptz,valid_until)),close_reason=CASE WHEN valid_until<=$3::timestamptz THEN 'LEASE_EXPIRED' ELSE $4 END WHERE project_id=$1 AND task_id=ANY($2::uuid[]) AND ended_at IS NULL`,
    [projectId, ids, instant, reason],
  );
  await client.query(
    'UPDATE task_claims SET revoked=true WHERE project_id=$1 AND task_id=ANY($2::uuid[]) AND NOT revoked',
    [projectId, ids],
  );
  for (const id of ids) {
    const row = (
      await client.query(
        'UPDATE work_items SET version=version+1 WHERE project_id=$1 AND id=$2 RETURNING version',
        [projectId, id],
      )
    ).rows[0];
    await env.event(
      id,
      'task.executionStopped',
      { version: row.version, sprintId, reason, stoppedAt: instant.toISOString() },
      'TASK',
    );
  }
}
export async function planningCommand(
  env: Environment,
  operation: PlanningOperation,
  id: string | null,
  payload: unknown,
) {
  const { client, projectId, principalId } = env;
  if (operation === 'create') {
    const input = createIterationSchema.parse(payload),
      iterationId = randomUUID(),
      publicId = `ITER-${await env.counter()}`;
    await client.query(
      'INSERT INTO iterations(id,project_id,public_id,name,goal,starts_on,ends_on,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        iterationId,
        projectId,
        publicId,
        input.name,
        input.goal,
        input.startsOn,
        input.endsOn,
        principalId,
      ],
    );
    const projectSeq = await env.event(
      iterationId,
      'iteration.created',
      { publicId, version: 1, ...input, status: 'PLANNED' },
      'ITERATION',
    );
    return { id: iterationId, publicId, version: 1, status: 'PLANNED', projectSeq };
  }
  if (operation === 'prepare') {
    const input = prepareSprintExecutionSchema.parse(payload);
    const ids = (
      await client.query<{ id: string }>(
        'SELECT w.id FROM work_items w WHERE w.project_id=$1 AND (EXISTS(SELECT 1 FROM task_claims c WHERE c.task_id=w.id AND NOT c.revoked) OR EXISTS(SELECT 1 FROM task_work_intervals t WHERE t.task_id=w.id AND t.ended_at IS NULL)) ORDER BY w.id FOR UPDATE',
        [projectId],
      )
    ).rows.map((r) => r.id);
    await stopWork(env, ids, 'SPRINT_PREPARATION', null);
    return { tasksStopped: ids.length, reason: input.reason };
  }
  if (operation === 'assignSprint') {
    const input = assignRequirementSprintSchema.parse(payload);
    const requirement = (
      await client.query(
        'SELECT version FROM requirements WHERE project_id=$1 AND id=$2 FOR UPDATE',
        [projectId, id],
      )
    ).rows[0];
    if (!requirement) throw new DomainError('REQUIREMENT_NOT_FOUND');
    if (requirement.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
    if (input.sprintId) await mutableSprint(client, projectId, input.sprintId);
    const tasks = (
      await client.query<{ id: string }>(
        'SELECT id FROM work_items WHERE project_id=$1 AND primary_requirement_id=$2 ORDER BY id FOR UPDATE',
        [projectId, id],
      )
    ).rows.map((t) => t.id);
    await inactiveWork(client, projectId, tasks);
    await client.query(
      'UPDATE requirements SET sprint_id=$3,version=version+1 WHERE project_id=$1 AND id=$2',
      [projectId, id, input.sprintId],
    );
    for (const taskId of tasks) {
      const updated = (
        await client.query(
          'UPDATE work_items SET version=version+1 WHERE id=$1 RETURNING version',
          [taskId],
        )
      ).rows[0];
      await env.event(
        taskId,
        'task.inheritedSprintChanged',
        {
          requirementId: id,
          sprintId: input.sprintId,
          version: updated.version,
          reason: input.reason,
        },
        'TASK',
      );
    }
    const projectSeq = await env.event(
      id!,
      'requirement.sprintAssigned',
      { ...input, version: requirement.version + 1 },
      'REQUIREMENT',
    );
    return { id: id!, version: requirement.version + 1, projectSeq };
  }
  if (operation === 'assignPrimary') {
    const input = assignPrimaryRequirementSchema.parse(payload);
    const task = (
      await client.query(
        'SELECT version FROM work_items WHERE project_id=$1 AND id=$2 FOR UPDATE',
        [projectId, id],
      )
    ).rows[0];
    if (!task) throw new DomainError('TASK_NOT_FOUND');
    if (task.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
    const linked = (
      await client.query(
        'SELECT r.sprint_id FROM requirements r JOIN requirement_task_links l ON l.project_id=r.project_id AND l.requirement_id=r.id WHERE l.project_id=$1 AND l.task_id=$2 AND l.requirement_id=$3',
        [projectId, id, input.requirementId],
      )
    ).rows[0];
    if (!linked) throw new DomainError('PRIMARY_REQUIREMENT_MUST_BE_LINKED');
    if (linked.sprint_id) await mutableSprint(client, projectId, linked.sprint_id);
    await inactiveWork(client, projectId, [id!]);
    await client.query(
      'UPDATE work_items SET primary_requirement_id=$3,version=version+1 WHERE project_id=$1 AND id=$2',
      [projectId, id, input.requirementId],
    );
    const projectSeq = await env.event(
      id!,
      'task.primaryRequirementAssigned',
      { ...input, version: task.version + 1 },
      'TASK',
    );
    return { id: id!, version: task.version + 1, projectSeq };
  }
  const sprint = (
    await client.query('SELECT * FROM iterations WHERE project_id=$1 AND id=$2 FOR UPDATE', [
      projectId,
      id,
    ])
  ).rows[0];
  if (!sprint) throw new DomainError('ITERATION_NOT_FOUND');
  const input =
    operation === 'update'
      ? updateIterationSchema.parse(payload)
      : transitionIterationSchema.parse(payload);
  if (input.expectedVersion !== sprint.version) throw new DomainError('VERSION_CONFLICT');
  if (['COMPLETED', 'CANCELLED'].includes(sprint.status)) throw new DomainError('SPRINT_TERMINAL');
  if (operation === 'update') {
    const updated = updateIterationSchema.parse(input);
    await client.query(
      'UPDATE iterations SET name=$3,goal=$4,starts_on=$5,ends_on=$6,version=version+1 WHERE project_id=$1 AND id=$2',
      [projectId, id, updated.name, updated.goal, updated.startsOn, updated.endsOn],
    );
  } else {
    const { to } = transitionIterationSchema.parse(input);
    const allowed: Record<string, string[]> = {
      PLANNED: ['ACTIVE', 'CANCELLED'],
      ACTIVE: ['PAUSED', 'COMPLETED', 'CANCELLED'],
      PAUSED: ['ACTIVE', 'CANCELLED'],
    };
    if (!allowed[sprint.status]?.includes(to)) throw new DomainError('INVALID_TRANSITION');
    if (
      to === 'ACTIVE' &&
      (
        await client.query(
          "SELECT 1 FROM iterations WHERE project_id=$1 AND status='ACTIVE' AND id<>$2",
          [projectId, id],
        )
      ).rowCount
    )
      throw new DomainError('ACTIVE_SPRINT_EXISTS');
    if (sprint.status === 'ACTIVE') {
      const ids = (
        await client.query<{ id: string }>(
          'SELECT w.id FROM work_items w JOIN requirements r ON r.project_id=w.project_id AND r.id=w.primary_requirement_id WHERE r.project_id=$1 AND r.sprint_id=$2 ORDER BY w.id FOR UPDATE OF w',
          [projectId, id],
        )
      ).rows.map((r) => r.id);
      await stopWork(env, ids, 'SPRINT_STOPPED', id);
    }
    await client.query(
      'UPDATE iterations SET status=$3,version=version+1 WHERE project_id=$1 AND id=$2',
      [projectId, id, to],
    );
  }
  const projectSeq = await env.event(
    id!,
    `iteration.${operation}`,
    { ...input, version: sprint.version + 1 },
    'ITERATION',
  );
  return {
    id: id!,
    version: sprint.version + 1,
    status: 'to' in input ? input.to : sprint.status,
    projectSeq,
  };
}
async function mutableSprint(client: pg.PoolClient, projectId: string, id: string) {
  const sprint = (
    await client.query('SELECT status FROM iterations WHERE project_id=$1 AND id=$2', [
      projectId,
      id,
    ])
  ).rows[0];
  if (!sprint) throw new DomainError('ITERATION_NOT_FOUND');
  if (['COMPLETED', 'CANCELLED'].includes(sprint.status)) throw new DomainError('SPRINT_TERMINAL');
}
