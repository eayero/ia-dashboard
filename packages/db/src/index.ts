import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { startWorkSchema, pauseWorkSchema } from '@acc/contracts';
import { startWorkInterval, pauseWorkInterval } from './work-time.ts';
import { registerRepository } from './repositories.ts';
import {
  governanceCommand,
  governanceSchemas,
  decisionImpactPending,
  type GovernanceOperation,
} from './governance.ts';
import {
  planningCommand,
  planningSchemas,
  assertTaskSprintActive,
  type PlanningOperation,
} from './iterations.ts';
export { taskPlanning } from './iterations.ts';
export { readEntityAttribution } from './attribution.ts';
export { decisionImpactPending } from './governance.ts';
import { registerRepositorySchema } from '@acc/contracts';
export { readTaskWorkTime } from './work-time.ts';
import {
  requirementCommand,
  requirementSchemas,
  type RequirementOperation,
} from './requirements.ts';
import {
  canonicalJson,
  DomainError,
  transition,
  approvalGates,
  type Actor,
  type Criterion,
  type Role,
  type TaskStatus,
  type Approval,
} from '@acc/domain';
import {
  createTaskSchema,
  claimTaskSchema,
  heartbeatClaimSchema,
  revokeClaimSchema,
  updateWorkSchema,
  reviseTaskSchema,
  transitionTaskSchema,
  addEvidenceSchema,
  acceptEvidenceSchema,
  approveTaskSchema,
  dependencySchema,
  emptyCommandSchema,
  sessionHeartbeatSchema,
  validateTaskSchema,
} from '@acc/contracts';
export const Pool = pg.Pool;
export { eventFromRow, type AuditEventRow } from './events.ts';
export { OutboxStore, type OutboxClaim } from './outbox.ts';

// Internal boundary: principalId MUST come from verified authentication, never a request body.
// Transport adapters authenticate callers before invoking this store.
export type CommandContext = {
  projectId: string;
  principalId: string;
  channel?: 'MCP' | 'WEB' | 'API';
};
type Task = { id: string; publicId: string; status: string; version: number; projectSeq: string };
type Lease = { fencingToken: string; expiresAt: string; version: number; projectSeq: string };
type LockedTask = {
  id: string;
  version: number;
  status: TaskStatus;
  title: string;
  criteria: Pick<Criterion, 'id' | 'description' | 'required'>[];
  work_revision: number;
  work_type: 'CODE' | 'OTHER';
  work_summary: string;
  impact_pending: boolean;
  manual_blocked: boolean;
  completion_version: number | null;
};

export class CoordinationStore {
  private pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  private async command<T>(
    context: CommandContext,
    command: string,
    key: string,
    payload: unknown,
    effect: (client: pg.PoolClient, actor: Actor) => Promise<T>,
    exclusiveGraph = false,
    requiredHumanRoles?: string[],
  ): Promise<T> {
    if (typeof key !== 'string' || !key.trim() || key.length > 200)
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
    const hash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      // Lock graph before ACL rows: project revocation must not wait on an ACL
      // reader that is itself waiting for the graph lock.
      const graphLock = exclusiveGraph ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared';
      await client.query(`SELECT ${graphLock}(hashtextextended($1,0))`, [
        `acc:graph:${context.projectId}`,
      ]);
      const membership = await client.query<Actor & { archived: boolean }>(
        `SELECT p.archived, u.kind, m.roles, m.scopes FROM projects p
         JOIN project_members m ON m.project_id=p.id JOIN principals u ON u.id=m.principal_id
         WHERE p.id=$1 AND u.id=$2 AND NOT u.disabled AND m.active AND (u.kind='HUMAN' OR agent_owner_project_access(u.id,p.id,true)) FOR SHARE OF p,m,u`,
        [context.projectId, context.principalId],
      );
      const actor = membership.rows[0];
      if (!actor) throw new DomainError('FORBIDDEN');
      if (actor.archived) throw new DomainError('PROJECT_ARCHIVED');
      const canWrite =
        actor.kind === 'HUMAN'
          ? actor.roles.some((role) => ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'].includes(role))
          : actor.scopes.includes('task:write');
      if (!canWrite) throw new DomainError('FORBIDDEN');
      if (requiredHumanRoles) this.requireRole(actor, requiredHumanRoles);
      const scope = [context.projectId, context.principalId, command, key];
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        canonicalJson(scope),
      ]);
      const previous = await client.query<{ payload_hash: string; response: T }>(
        'SELECT payload_hash,response FROM idempotency_records WHERE project_id=$1 AND principal_id=$2 AND command=$3 AND key=$4 AND expires_at>clock_timestamp()',
        scope,
      );
      if (previous.rows[0]) {
        if (previous.rows[0].payload_hash !== hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED');
        await client.query('COMMIT');
        return previous.rows[0].response;
      }
      const result = await effect(client, actor);
      await client.query(
        `INSERT INTO idempotency_records(project_id,principal_id,command,key,payload_hash,response) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(project_id,principal_id,command,key) DO UPDATE SET payload_hash=EXCLUDED.payload_hash,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`,
        [...scope, hash, JSON.stringify(result)],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '55P03')
        throw new DomainError('REQUEST_IN_PROGRESS');
      throw error;
    } finally {
      client.release();
    }
  }

  private async counter(
    client: pg.PoolClient,
    projectId: string,
    kind: 'TASK' | 'EVENT' | 'REQ' | 'ITER' | 'Q' | 'DEC',
  ): Promise<string> {
    const result = await client.query<{ value: string }>(
      `INSERT INTO project_counters(project_id,kind,value) VALUES ($1,$2,1)
      ON CONFLICT(project_id,kind) DO UPDATE SET value=project_counters.value+1 RETURNING value`,
      [projectId, kind],
    );
    return result.rows[0]!.value;
  }

  private async event(
    client: pg.PoolClient,
    context: CommandContext,
    entityId: string,
    action: string,
    payload: unknown,
    sessionId: string | null = null,
    entityType:
      | 'TASK'
      | 'SESSION'
      | 'PRINCIPAL'
      | 'REQUIREMENT'
      | 'REPOSITORY'
      | 'ITERATION'
      | 'QUESTION'
      | 'DECISION' = 'TASK',
  ): Promise<string> {
    const seq = await this.counter(client, context.projectId, 'EVENT');
    const id = randomUUID();
    await client.query(
      'INSERT INTO audit_events(id,project_id,seq,actor_id,session_id,entity_id,action,payload,trace_id,entity_type,channel) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        id,
        context.projectId,
        seq,
        context.principalId,
        sessionId,
        entityId,
        action,
        JSON.stringify(payload),
        randomUUID(),
        entityType,
        context.channel ?? 'UNKNOWN',
      ],
    );
    await client.query('INSERT INTO event_outbox(event_id) VALUES ($1)', [id]);
    return seq;
  }

  async registerRepository(context: CommandContext, key: string, payload: unknown) {
    const input = registerRepositorySchema.parse(payload);
    return this.command(
      context,
      'repository.register',
      key,
      input,
      (client, actor) =>
        registerRepository(client, context.projectId, actor, input, (id, data) =>
          this.event(client, context, id, 'repository.registered', data, null, 'REPOSITORY'),
        ),
      true,
      ['OWNER', 'ADMIN', 'MANAGER'],
    );
  }

  private planning(
    context: CommandContext,
    key: string,
    operation: PlanningOperation,
    id: string | null,
    payload: unknown,
  ) {
    const input = planningSchemas[operation].parse(payload);
    return this.command(
      context,
      `planning.${operation}`,
      key,
      { id, ...input },
      (client) =>
        planningCommand(
          {
            client,
            ...context,
            counter: () => this.counter(client, context.projectId, 'ITER'),
            event: (entityId, action, data, type) =>
              this.event(client, context, entityId, action, data, null, type),
          },
          operation,
          id,
          input,
        ),
      true,
      ['OWNER', 'ADMIN', 'MANAGER'],
    );
  }
  createIteration(context: CommandContext, key: string, payload: unknown) {
    return this.planning(context, key, 'create', null, payload);
  }
  updateIteration(context: CommandContext, key: string, id: string, payload: unknown) {
    return this.planning(context, key, 'update', id, payload);
  }
  transitionIteration(context: CommandContext, key: string, id: string, payload: unknown) {
    return this.planning(context, key, 'transition', id, payload);
  }
  assignRequirementSprint(context: CommandContext, key: string, id: string, payload: unknown) {
    return this.planning(context, key, 'assignSprint', id, payload);
  }
  assignPrimaryRequirement(context: CommandContext, key: string, id: string, payload: unknown) {
    return this.planning(context, key, 'assignPrimary', id, payload);
  }
  prepareSprintExecution(context: CommandContext, key: string, payload: unknown) {
    return this.planning(context, key, 'prepare', null, payload);
  }

  private governance(
    context: CommandContext,
    key: string,
    op: GovernanceOperation,
    id: string | null,
    payload: unknown,
  ) {
    const input = governanceSchemas[op].parse(payload);
    const humanRoles: Role[] | undefined =
      op === 'resolveQuestion'
        ? ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER']
        : [
              'changeQuestionStatus',
              'linkQuestion',
              'approveDecision',
              'linkDecision',
              'evaluateDecisionImpact',
            ].includes(op)
          ? ['OWNER', 'ADMIN', 'MANAGER']
          : undefined;
    return this.command(
      context,
      `governance.${op}`,
      key,
      { id, ...input },
      (client) =>
        governanceCommand(
          {
            client,
            ...context,
            counter: (kind) => this.counter(client, context.projectId, kind),
            event: (entityId, action, data, type) =>
              this.event(client, context, entityId, action, data, null, type),
            questionTask: (taskId, questionId) =>
              this.reconcileQuestionState(client, context, taskId, questionId),
          },
          op,
          id,
          input,
        ),
      true,
      humanRoles,
    );
  }
  createQuestion(c: CommandContext, k: string, p: unknown) {
    return this.governance(c, k, 'createQuestion', null, p);
  }
  reviseQuestion(c: CommandContext, k: string, id: string, p: unknown) {
    return this.governance(c, k, 'reviseQuestion', id, p);
  }
  answerQuestion(c: CommandContext, k: string, id: string, p: unknown) {
    return this.governance(c, k, 'answerQuestion', id, p);
  }
  resolveQuestion(c: CommandContext, k: string, id: string, p: unknown) {
    return this.governance(c, k, 'resolveQuestion', id, p);
  }
  changeQuestionStatus(c: CommandContext, k: string, id: string, p: unknown) {
    return this.governance(c, k, 'changeQuestionStatus', id, p);
  }
  linkQuestion(c: CommandContext, k: string, id: string, p: unknown) {
    return this.governance(c, k, 'linkQuestion', id, p);
  }
  createDecision(c: CommandContext, k: string, p: unknown) {
    return this.governance(c, k, 'createDecision', null, p);
  }
  reviseDecision(c: CommandContext, k: string, id: string, p: unknown) {
    return this.governance(c, k, 'reviseDecision', id, p);
  }
  approveDecision(c: CommandContext, k: string, id: string, p: unknown) {
    return this.governance(c, k, 'approveDecision', id, p);
  }
  linkDecision(c: CommandContext, k: string, id: string, p: unknown) {
    return this.governance(c, k, 'linkDecision', id, p);
  }
  evaluateDecisionImpact(c: CommandContext, k: string, id: string, p: unknown) {
    return this.governance(c, k, 'evaluateDecisionImpact', id, p);
  }

  private async reconcileQuestionState(
    client: pg.PoolClient,
    context: CommandContext,
    taskId: string,
    questionId: string,
  ) {
    const task = await this.lockTask(client, context, taskId),
      met = await this.dependenciesMet(client, context, taskId);
    const open = Boolean(
      (
        await client.query(
          "SELECT 1 FROM question_task_links l JOIN questions q ON q.project_id=l.project_id AND q.id=l.question_id WHERE l.project_id=$1 AND l.task_id=$2 AND l.question_id=$3 AND l.hard AND q.status='OPEN'",
          [context.projectId, taskId, questionId],
        )
      ).rowCount,
    );
    if (task.status === 'DONE' && open)
      await client.query(
        'INSERT INTO question_task_alerts(id,project_id,question_id,task_id) VALUES ($1,$2,$3,$4)',
        [randomUUID(), context.projectId, questionId, taskId],
      );
    let status = task.status;
    if (!met && ['BACKLOG', 'READY', 'IN_PROGRESS', 'IN_REVIEW', 'IN_QA'].includes(status)) {
      status = 'BLOCKED';
      await this.invalidateClaim(client, taskId);
      await this.invalidateApprovals(client, taskId);
    } else if (met && status === 'BLOCKED' && !task.manual_blocked) status = 'READY';
    await client.query(
      'UPDATE work_items SET status=$3,version=version+1 WHERE project_id=$1 AND id=$2',
      [context.projectId, taskId, status],
    );
    const version = task.version + 1;
    await this.event(client, context, taskId, 'task.questionChanged', {
      questionId,
      version,
      from: task.status,
      to: status,
      open,
    });
    return version;
  }

  private requirement(
    context: CommandContext,
    key: string,
    operation: RequirementOperation,
    id: string | null,
    payload: unknown,
  ) {
    const input = requirementSchemas[operation].parse(payload);
    return this.command(
      context,
      `requirement.${operation}`,
      key,
      { id, ...input },
      (client, actor) =>
        requirementCommand(
          {
            client,
            actor,
            ...context,
            counter: () => this.counter(client, context.projectId, 'REQ'),
            event: (entityId, action, data, type = 'REQUIREMENT') =>
              this.event(client, context, entityId, action, data, null, type),
          },
          operation,
          id,
          input,
        ),
      true,
    );
  }
  createRequirement(context: CommandContext, key: string, payload: unknown) {
    return this.requirement(context, key, 'create', null, payload);
  }
  reviseRequirement(context: CommandContext, key: string, id: string, payload: unknown) {
    return this.requirement(context, key, 'revise', id, payload);
  }
  approveRequirement(context: CommandContext, key: string, id: string, payload: unknown) {
    return this.requirement(context, key, 'approve', id, payload);
  }
  linkRequirement(context: CommandContext, key: string, id: string, payload: unknown) {
    return this.requirement(context, key, 'link', id, payload);
  }
  evaluateRequirementImpact(context: CommandContext, key: string, id: string, payload: unknown) {
    return this.requirement(context, key, 'evaluate', id, payload);
  }

  async startWork(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = startWorkSchema.parse(payload);
    return this.command(
      context,
      'work.start',
      key,
      { taskId, ...input },
      async (client, actor) => {
        if (actor.kind !== 'AGENT') throw new DomainError('FORBIDDEN');
        const task = await this.lockTask(client, context, taskId);
        await assertTaskSprintActive(client, context.projectId, taskId);
        this.assertVersion(task, input.expectedVersion);
        await this.assertLease(client, context, taskId, input);
        if (task.status !== 'IN_PROGRESS') throw new DomainError('INVALID_TRANSITION');
        const interval = await startWorkInterval(
          client,
          context,
          taskId,
          task.work_revision,
          input,
        );
        await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
        const version = task.version + 1,
          projectSeq = await this.event(
            client,
            context,
            taskId,
            'work.started',
            {
              id: interval.id,
              version,
              startedAt: interval.startedAt.toISOString(),
              validUntil: interval.validUntil.toISOString(),
            },
            input.sessionId,
          );
        return {
          id: interval.id,
          version,
          projectSeq,
          startedAt: interval.startedAt.toISOString(),
          validUntil: interval.validUntil.toISOString(),
        };
      },
      true,
    );
  }
  async pauseWork(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = pauseWorkSchema.parse(payload);
    return this.command(
      context,
      'work.pause',
      key,
      { taskId, ...input },
      async (client, actor) => {
        if (actor.kind !== 'AGENT') throw new DomainError('FORBIDDEN');
        const task = await this.lockTask(client, context, taskId);
        this.assertVersion(task, input.expectedVersion);
        await this.assertLease(client, context, taskId, input);
        const interval = await pauseWorkInterval(client, context, taskId, input);
        await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
        const version = task.version + 1,
          projectSeq = await this.event(
            client,
            context,
            taskId,
            'work.paused',
            { id: interval.id, version, endedAt: interval.endedAt.toISOString() },
            input.sessionId,
          );
        return { id: interval.id, version, projectSeq, endedAt: interval.endedAt.toISOString() };
      },
      true,
    );
  }

  async createTask(context: CommandContext, key: string, payload: unknown): Promise<Task> {
    const input = createTaskSchema.parse(payload);
    return this.command(
      context,
      'task.create',
      key,
      input,
      async (client) => {
        if (input.externalRef) {
          // Serialize exact external identity even when callers use different idempotency keys.
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            canonicalJson([context.projectId, 'externalRef', input.externalRef]),
          ]);
          const existing = await client.query<{
            id: string;
            public_id: string;
            status: string;
            version: number;
          }>(
            'SELECT id,public_id,status,version FROM work_items WHERE project_id=$1 AND external_ref=$2',
            [context.projectId, input.externalRef],
          );
          if (existing.rows[0]) {
            const task = existing.rows[0];
            const seq = await client.query<{ value: string }>(
              "SELECT value FROM project_counters WHERE project_id=$1 AND kind='EVENT'",
              [context.projectId],
            );
            return {
              id: task.id,
              publicId: task.public_id,
              status: task.status,
              version: task.version,
              projectSeq: seq.rows[0]?.value ?? '0',
            };
          }
        }
        const requirements = await client.query<{ id: string; approved_revision: number | null }>(
          'SELECT id,approved_revision FROM requirements WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
          [context.projectId, input.requirementIds],
        );
        if (requirements.rowCount !== input.requirementIds.length)
          throw new DomainError('REQUIREMENT_NOT_FOUND');
        const id = randomUUID();
        const publicId = `TASK-${await this.counter(client, context.projectId, 'TASK')}`;
        await client.query(
          'INSERT INTO work_items(id,project_id,public_id,title,criteria,external_ref,created_by,work_type,primary_requirement_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            id,
            context.projectId,
            publicId,
            input.title,
            JSON.stringify(input.criteria),
            input.externalRef ?? null,
            context.principalId,
            input.workType,
            input.primaryRequirementId,
          ],
        );
        for (const requirement of requirements.rows) {
          await client.query(
            'INSERT INTO requirement_task_links(project_id,requirement_id,task_id,evaluated_revision) VALUES ($1,$2,$3,$4)',
            [context.projectId, requirement.id, id, requirement.approved_revision],
          );
          await client.query(
            'UPDATE requirements SET version=version+1 WHERE project_id=$1 AND id=$2',
            [context.projectId, requirement.id],
          );
        }
        await client.query(
          'UPDATE work_items SET impact_pending=$3 WHERE project_id=$1 AND id=$2',
          [context.projectId, id, requirements.rows.some((r) => r.approved_revision === null)],
        );
        const projectSeq = await this.event(client, context, id, 'task.created', {
          publicId,
          version: 1,
          requirementIds: input.requirementIds,
          requirementBaselines: requirements.rows.map((r) => ({
            requirementId: r.id,
            revision: r.approved_revision,
          })),
        });
        return { id, publicId, status: 'BACKLOG', version: 1, projectSeq };
      },
      true,
    );
  }

  private async lockTask(
    client: pg.PoolClient,
    context: CommandContext,
    taskId: string,
  ): Promise<LockedTask> {
    const result = await client.query<LockedTask>(
      'SELECT id,version,status,title,criteria,work_revision,work_type,work_summary,impact_pending,manual_blocked,completion_version FROM work_items WHERE project_id=$1 AND id=$2 FOR UPDATE',
      [context.projectId, taskId],
    );
    if (!result.rows[0]) throw new DomainError('TASK_NOT_FOUND');
    return result.rows[0];
  }

  private async session(
    client: pg.PoolClient,
    context: CommandContext,
    sessionId: string,
  ): Promise<void> {
    const result = await client.query(
      'SELECT id FROM agent_sessions WHERE project_id=$1 AND principal_id=$2 AND id=$3 AND ended_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',
      [context.projectId, context.principalId, sessionId],
    );
    if (!result.rowCount) throw new DomainError('SESSION_INACTIVE');
  }

  async claimTask(
    context: CommandContext,
    key: string,
    taskId: string,
    payload: unknown,
  ): Promise<Lease> {
    const input = claimTaskSchema.parse(payload);
    return this.command(context, 'task.claim', key, { taskId, ...input }, async (client) => {
      const task = await this.lockTask(client, context, taskId);
      await assertTaskSprintActive(client, context.projectId, taskId);
      await this.session(client, context, input.sessionId);
      const paused = await client.query<{ claims_paused: boolean }>(
        'SELECT claims_paused FROM projects WHERE id=$1',
        [context.projectId],
      );
      if (paused.rows[0]!.claims_paused) throw new DomainError('CLAIMS_PAUSED');
      if (!(await this.dependenciesMet(client, context, taskId)))
        throw new DomainError('DEPENDENCIES_UNMET');
      const active = await client.query(
        `SELECT c.task_id FROM task_claims c JOIN agent_sessions s ON s.id=c.session_id
        WHERE c.task_id=$1 AND NOT c.revoked AND c.expires_at>clock_timestamp() AND s.ended_at IS NULL AND s.expires_at>clock_timestamp()`,
        [taskId],
      );
      if (active.rowCount) throw new DomainError('TASK_ALREADY_CLAIMED');
      if (task.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      if (!['READY', 'IN_PROGRESS'].includes(task.status))
        throw new DomainError('INVALID_TRANSITION');
      const lease = await client.query<{ fencing_token: string; expires_at: Date }>(
        `INSERT INTO task_claims(project_id,task_id,principal_id,session_id,fencing_token,expires_at)
        VALUES ($1,$2,$3,$4,1,clock_timestamp()+interval '10 minutes') ON CONFLICT(task_id)
        DO UPDATE SET principal_id=EXCLUDED.principal_id,session_id=EXCLUDED.session_id,fencing_token=task_claims.fencing_token+1,expires_at=EXCLUDED.expires_at,revoked=false RETURNING fencing_token,expires_at`,
        [context.projectId, taskId, context.principalId, input.sessionId],
      );
      await client.query(
        "UPDATE work_items SET status='IN_PROGRESS',version=version+1 WHERE id=$1",
        [taskId],
      );
      const fencingToken = lease.rows[0]!.fencing_token;
      const version = task.version + 1;
      const projectSeq = await this.event(
        client,
        context,
        taskId,
        'claim.acquired',
        { fencingToken, version },
        input.sessionId,
      );
      return {
        fencingToken,
        version,
        projectSeq,
        expiresAt: lease.rows[0]!.expires_at.toISOString(),
      };
    });
  }

  async heartbeatClaim(
    context: CommandContext,
    key: string,
    taskId: string,
    payload: unknown,
  ): Promise<Lease> {
    const input = heartbeatClaimSchema.parse(payload);
    return this.command(context, 'claim.heartbeat', key, { taskId, ...input }, async (client) => {
      const task = await this.lockTask(client, context, taskId);
      await assertTaskSprintActive(client, context.projectId, taskId);
      await this.session(client, context, input.sessionId);
      const claim = await client.query(
        `SELECT task_id FROM task_claims WHERE task_id=$1 AND project_id=$2 AND principal_id=$3 AND session_id=$4
        AND fencing_token=$5 AND NOT revoked AND expires_at>clock_timestamp() FOR UPDATE`,
        [taskId, context.projectId, context.principalId, input.sessionId, input.fencingToken],
      );
      if (!claim.rowCount) throw new DomainError('STALE_CLAIM');
      if (task.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      const renewed = await client.query<{ expires_at: Date }>(
        "UPDATE task_claims SET expires_at=clock_timestamp()+interval '10 minutes' WHERE task_id=$1 RETURNING expires_at",
        [taskId],
      );
      await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
      const version = task.version + 1;
      const projectSeq = await this.event(
        client,
        context,
        taskId,
        'claim.renewed',
        { version, fencingToken: input.fencingToken },
        input.sessionId,
      );
      return {
        version,
        fencingToken: input.fencingToken,
        projectSeq,
        expiresAt: renewed.rows[0]!.expires_at.toISOString(),
      };
    });
  }

  private async assertLease(
    client: pg.PoolClient,
    context: CommandContext,
    taskId: string,
    input: { sessionId: string; fencingToken: string },
  ): Promise<void> {
    await this.session(client, context, input.sessionId);
    const claim = await client.query(
      `SELECT task_id FROM task_claims WHERE task_id=$1 AND project_id=$2 AND principal_id=$3 AND session_id=$4
      AND fencing_token=$5 AND NOT revoked AND expires_at>clock_timestamp() FOR UPDATE`,
      [taskId, context.projectId, context.principalId, input.sessionId, input.fencingToken],
    );
    if (!claim.rowCount) throw new DomainError('STALE_CLAIM');
  }

  private assertVersion(task: LockedTask, expectedVersion: number): void {
    if (task.version !== expectedVersion) throw new DomainError('VERSION_CONFLICT');
  }

  private requireRole(actor: Actor, roles: string[]): void {
    if (actor.kind !== 'HUMAN' || !actor.roles.some((role) => roles.includes(role)))
      throw new DomainError('FORBIDDEN');
  }

  private async invalidateClaim(client: pg.PoolClient, taskId: string): Promise<void> {
    await client.query(
      'UPDATE task_claims SET revoked=true,fencing_token=fencing_token+1 WHERE task_id=$1 AND NOT revoked',
      [taskId],
    );
  }

  async releaseClaim(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = heartbeatClaimSchema.parse(payload);
    return this.command(context, 'claim.release', key, { taskId, ...input }, async (client) => {
      const task = await this.lockTask(client, context, taskId);
      await this.assertLease(client, context, taskId, input);
      this.assertVersion(task, input.expectedVersion);
      await this.invalidateClaim(client, taskId);
      await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
      const version = task.version + 1;
      const projectSeq = await this.event(
        client,
        context,
        taskId,
        'claim.released',
        { version },
        input.sessionId,
      );
      return { version, projectSeq };
    });
  }

  async revokeClaim(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = revokeClaimSchema.parse(payload);
    return this.command(
      context,
      'claim.revoke',
      key,
      { taskId, ...input },
      async (client, actor) => {
        this.requireRole(actor, ['OWNER', 'ADMIN']);
        const task = await this.lockTask(client, context, taskId);
        this.assertVersion(task, input.expectedVersion);
        await this.invalidateClaim(client, taskId);
        await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
        const version = task.version + 1;
        const projectSeq = await this.event(client, context, taskId, 'claim.revoked', {
          version,
          reason: input.reason,
        });
        return { version, projectSeq };
      },
    );
  }

  private assertMutable(task: LockedTask): void {
    if (['DONE', 'CANCELLED'].includes(task.status)) throw new DomainError('TASK_TERMINAL');
  }

  private async invalidateApprovals(client: pg.PoolClient, taskId: string): Promise<void> {
    await client.query(
      'UPDATE approvals SET invalidated_at=clock_timestamp() WHERE task_id=$1 AND invalidated_at IS NULL',
      [taskId],
    );
  }

  private snapshot(task: LockedTask) {
    return {
      title: task.title,
      criteria: task.criteria,
      summary: task.work_summary,
      workType: task.work_type,
      workRevision: task.work_revision,
    };
  }

  async updateWork(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = updateWorkSchema.parse(payload);
    return this.command(context, 'task.updateWork', key, { taskId, ...input }, async (client) => {
      const task = await this.lockTask(client, context, taskId);
      await assertTaskSprintActive(client, context.projectId, taskId);
      await this.assertLease(client, context, taskId, input);
      this.assertVersion(task, input.expectedVersion);
      if (task.status !== 'IN_PROGRESS') throw new DomainError('INVALID_TRANSITION');
      if (task.work_summary === input.summary) throw new DomainError('NO_WORK_CHANGE');
      await client.query(
        'UPDATE work_items SET work_summary=$2,version=version+1,work_revision=work_revision+1 WHERE id=$1',
        [taskId, input.summary],
      );
      await this.invalidateApprovals(client, taskId);
      const version = task.version + 1;
      const workRevision = task.work_revision + 1;
      const projectSeq = await this.event(
        client,
        context,
        taskId,
        'task.workUpdated',
        {
          version,
          before: this.snapshot(task),
          after: { ...this.snapshot(task), summary: input.summary, workRevision },
        },
        input.sessionId,
      );
      return { version, workRevision, projectSeq };
    });
  }

  async reviseTask(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = reviseTaskSchema.parse(payload);
    return this.command(
      context,
      'task.revise',
      key,
      { taskId, ...input },
      async (client, actor) => {
        this.requireRole(actor, ['OWNER', 'ADMIN', 'MANAGER']);
        const task = await this.lockTask(client, context, taskId);
        this.assertVersion(task, input.expectedVersion);
        this.assertMutable(task);
        await this.invalidateClaim(client, taskId);
        await this.invalidateApprovals(client, taskId);
        await client.query(
          "UPDATE work_items SET title=$2,criteria=$3,work_type=$4,work_summary='',status='BACKLOG',manual_blocked=false,version=version+1,work_revision=work_revision+1 WHERE id=$1",
          [taskId, input.title, JSON.stringify(input.criteria), input.workType],
        );
        const version = task.version + 1;
        const workRevision = task.work_revision + 1;
        const projectSeq = await this.event(client, context, taskId, 'task.revised', {
          version,
          reason: input.reason,
          before: this.snapshot(task),
          after: {
            title: input.title,
            criteria: input.criteria,
            workType: input.workType,
            summary: '',
            workRevision,
          },
        });
        return { version, workRevision, status: 'BACKLOG' as const, projectSeq };
      },
      true,
    );
  }

  private async dependenciesMet(
    client: pg.PoolClient,
    context: CommandContext,
    taskId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM task_dependencies d JOIN work_items w ON w.project_id=d.project_id AND w.id=d.depends_on WHERE d.project_id=$1 AND d.task_id=$2 AND w.status<>'DONE' UNION ALL SELECT 1 FROM question_task_links l JOIN questions q ON q.project_id=l.project_id AND q.id=l.question_id WHERE l.project_id=$1 AND l.task_id=$2 AND l.hard AND q.status='OPEN' LIMIT 1`,
      [context.projectId, taskId],
    );
    return !result.rowCount;
  }

  private async gates(client: pg.PoolClient, context: CommandContext, task: LockedTask) {
    const evidence = await client.query<{
      id: string;
      kind: string;
      repository_id: string | null;
      commit_sha: string | null;
      test_result: { outcome: 'PASS' | 'FAIL' } | null;
      criterion_ids: string[];
    }>(
      `SELECT e.id,e.kind,e.repository_id,e.commit_sha,e.test_result,array_agg(c.criterion_id) AS criterion_ids FROM evidence e JOIN evidence_criteria c ON c.evidence_id=e.id WHERE e.project_id=$1 AND e.task_id=$2 AND e.work_revision=$3 GROUP BY e.id`,
      [context.projectId, task.id, task.work_revision],
    );
    const accepted = evidence.rows;
    const eligible = accepted.filter(
      (row) => row.kind !== 'TEST' || row.test_result?.outcome === 'PASS',
    );
    const matchesCode = (row: (typeof accepted)[number]) =>
      row.kind === 'TEST' &&
      row.test_result?.outcome === 'PASS' &&
      accepted.some(
        (code) =>
          code.kind === 'CODE' &&
          code.repository_id === row.repository_id &&
          code.commit_sha === row.commit_sha,
      );
    const criterionEvidence = (criterionId: string) =>
      eligible.filter(
        (e) =>
          e.criterion_ids.includes(criterionId) && (task.work_type !== 'CODE' || matchesCode(e)),
      );
    const criteria = task.criteria.map((criterion) => {
      const rows = criterionEvidence(criterion.id);
      return { ...criterion, verified: rows.length > 0, evidenceIds: rows.map((e) => e.id) };
    });
    const approvals = await client.query<{
      kind: Approval['kind'];
      work_revision: number;
      approved_roles: Role[];
    }>(
      'SELECT kind,work_revision,approved_roles FROM approvals WHERE project_id=$1 AND task_id=$2 AND work_revision=$3 AND invalidated_at IS NULL',
      [context.projectId, task.id, task.work_revision],
    );
    return {
      criteria,
      evidenceAccepted:
        task.work_type === 'CODE' ? accepted.some(matchesCode) : eligible.length > 0,
      dependenciesMet: await this.dependenciesMet(client, context, task.id),
      impactPending:
        task.impact_pending || (await decisionImpactPending(client, context.projectId, task.id)),
      ...approvalGates(
        task.work_revision,
        approvals.rows.map((a) => ({
          kind: a.kind,
          workRevision: a.work_revision,
          approved: true,
          actor: { kind: 'HUMAN', roles: a.approved_roles, scopes: [] },
        })),
      ),
    };
  }

  async addEvidence(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = addEvidenceSchema.parse(payload);
    return this.command(context, 'evidence.add', key, { taskId, ...input }, async (client) => {
      const task = await this.lockTask(client, context, taskId);
      await assertTaskSprintActive(client, context.projectId, taskId);
      // Agents may attach review/QA reports without holding an implementation claim.
      const report = input.kind === 'REVIEW' && ['IN_REVIEW', 'IN_QA'].includes(task.status);
      if (!report) {
        if (!input.sessionId || !input.fencingToken) throw new DomainError('CLAIM_REQUIRED');
        await this.assertLease(client, context, taskId, {
          sessionId: input.sessionId,
          fencingToken: input.fencingToken,
        });
        if (task.status !== 'IN_PROGRESS') throw new DomainError('INVALID_TRANSITION');
      } else if (input.sessionId && input.fencingToken) {
        await this.assertLease(client, context, taskId, {
          sessionId: input.sessionId,
          fencingToken: input.fencingToken,
        });
      }
      this.assertVersion(task, input.expectedVersion);
      this.assertMutable(task);
      if (input.criterionIds.some((id) => !task.criteria.some((c) => c.id === id)))
        throw new DomainError('CRITERION_NOT_FOUND');
      if (input.repositoryId) {
        const repository = await client.query(
          'SELECT id FROM repositories WHERE project_id=$1 AND id=$2',
          [context.projectId, input.repositoryId],
        );
        if (!repository.rowCount) throw new DomainError('REPOSITORY_NOT_FOUND');
      }
      const id = randomUUID();
      await client.query(
        'INSERT INTO evidence(id,project_id,task_id,work_revision,kind,url,repository_id,commit_sha,declared_by,test_result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id,
          context.projectId,
          taskId,
          task.work_revision,
          input.kind,
          input.url,
          input.repositoryId ?? null,
          input.commit ?? null,
          context.principalId,
          input.result ? JSON.stringify(input.result) : null,
        ],
      );
      for (const criterionId of input.criterionIds)
        await client.query(
          'INSERT INTO evidence_criteria(project_id,task_id,evidence_id,criterion_id) VALUES ($1,$2,$3,$4)',
          [context.projectId, taskId, id, criterionId],
        );
      await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
      const version = task.version + 1;
      const projectSeq = await this.event(
        client,
        context,
        taskId,
        'evidence.declared',
        { version, evidenceId: id, workRevision: task.work_revision, kind: input.kind },
        report ? null : input.sessionId!,
      );
      return {
        id,
        version,
        workRevision: task.work_revision,
        provenance: 'DECLARED' as const,
        projectSeq,
      };
    });
  }

  async acceptEvidence(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = acceptEvidenceSchema.parse(payload);
    return this.command(
      context,
      'evidence.accept',
      key,
      { taskId, ...input },
      async (client, actor) => {
        this.requireRole(actor, ['OWNER', 'ADMIN', 'REVIEWER']);
        const task = await this.lockTask(client, context, taskId);
        this.assertVersion(task, input.expectedVersion);
        this.assertMutable(task);
        const evidence = await client.query(
          'UPDATE evidence SET accepted_by=$4,accepted_at=clock_timestamp() WHERE project_id=$1 AND task_id=$2 AND id=$3 AND work_revision=$5 AND accepted_by IS NULL RETURNING id',
          [context.projectId, taskId, input.evidenceId, context.principalId, task.work_revision],
        );
        if (!evidence.rowCount) throw new DomainError('EVIDENCE_NOT_ACCEPTABLE');
        await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
        const version = task.version + 1;
        const projectSeq = await this.event(client, context, taskId, 'evidence.accepted', {
          version,
          evidenceId: input.evidenceId,
          workRevision: task.work_revision,
        });
        return { version, projectSeq, provenance: 'HUMAN_ACCEPTED' as const };
      },
    );
  }

  async approveTask(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = approveTaskSchema.parse(payload);
    return this.command(
      context,
      'approval.grant',
      key,
      { taskId, ...input },
      async (client, actor) => {
        this.requireRole(actor, ['OWNER', 'ADMIN', 'REVIEWER']);
        const task = await this.lockTask(client, context, taskId);
        this.assertVersion(task, input.expectedVersion);
        if (task.work_revision !== input.workRevision)
          throw new DomainError('WORK_REVISION_CONFLICT');
        if (task.status !== (input.kind === 'REVIEW' ? 'IN_REVIEW' : 'IN_QA'))
          throw new DomainError('INVALID_APPROVAL_STAGE');
        const gates = await this.gates(client, context, task);
        // Reuse the domain's gates, allowing only the stage being approved here.
        transition({
          from: input.kind === 'REVIEW' ? 'IN_REVIEW' : 'IN_QA',
          to: input.kind === 'REVIEW' ? 'IN_QA' : 'DONE',
          actor,
          hasClaim: false,
          ...gates,
          reviewApproved: input.kind === 'REVIEW' || gates.reviewApproved,
          qaApproved: input.kind === 'QA' || gates.qaApproved,
          closureApproved: true,
        });
        if (!gates.evidenceAccepted) throw new DomainError('EVIDENCE_REQUIRED');
        if (gates.criteria.some((c) => c.required && !c.verified))
          throw new DomainError('CRITERIA_UNMET');
        const id = randomUUID();
        const added = await client.query(
          'INSERT INTO approvals(id,project_id,task_id,work_revision,kind,principal_id,approved_roles) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',
          [
            id,
            context.projectId,
            taskId,
            task.work_revision,
            input.kind,
            context.principalId,
            actor.roles,
          ],
        );
        if (!added.rowCount) throw new DomainError('APPROVAL_ALREADY_RESOLVED');
        await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
        const version = task.version + 1;
        const projectSeq = await this.event(client, context, taskId, 'approval.granted', {
          version,
          approvalId: id,
          kind: input.kind,
          workRevision: task.work_revision,
        });
        return { id, version, projectSeq };
      },
    );
  }

  async transitionTask(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = transitionTaskSchema.parse(payload);
    return this.command(
      context,
      'task.transition',
      key,
      { taskId, ...input },
      async (client, actor) => {
        const task = await this.lockTask(client, context, taskId);
        this.assertVersion(task, input.expectedVersion);
        let hasClaim = false;
        if (['IN_PROGRESS', 'IN_REVIEW', 'IN_QA', 'DONE'].includes(input.to))
          await assertTaskSprintActive(client, context.projectId, taskId);
        if (input.sessionId && input.fencingToken) {
          await this.assertLease(client, context, taskId, {
            sessionId: input.sessionId,
            fencingToken: input.fencingToken,
          });
          hasClaim = true;
        }
        const result = transition({
          from: task.status,
          to: input.to,
          actor,
          hasClaim,
          ...(await this.gates(client, context, task)),
          reason: input.reason,
        });
        if (result.releaseClaim) await this.invalidateClaim(client, taskId);
        if (input.to === 'IN_PROGRESS' || task.status === 'DONE' || input.to === 'CANCELLED')
          await this.invalidateApprovals(client, taskId);
        await client.query(
          "UPDATE work_items SET status=$2,version=version+1,manual_blocked=$3,completion_version=CASE WHEN $2='DONE' THEN version+1 ELSE NULL END WHERE id=$1",
          [taskId, result.status, input.to === 'BLOCKED'],
        );
        const version = task.version + 1;
        const projectSeq = await this.event(
          client,
          context,
          taskId,
          'task.transitioned',
          { version, from: task.status, to: result.status, reason: input.reason ?? null },
          input.sessionId ?? null,
        );
        await this.reconcileDependents(
          client,
          context,
          taskId,
          task.status === 'DONE' && result.status !== 'DONE',
        );
        return { version, status: result.status, workRevision: task.work_revision, projectSeq };
      },
      true,
    );
  }

  async validateTask(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = validateTaskSchema.parse(payload);
    return this.command(
      context,
      'task.validate',
      key,
      { taskId, ...input },
      async (client, actor) => {
        this.requireRole(actor, ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER']);
        const task = await this.lockTask(client, context, taskId);
        this.assertVersion(task, input.expectedVersion);
        if (task.status !== 'DONE') throw new DomainError('TASK_NOT_DONE');
        if (task.work_revision !== input.workRevision)
          throw new DomainError('WORK_REVISION_CONFLICT');
        const id = randomUUID();
        const added = await client.query(
          'INSERT INTO task_validations(id,project_id,task_id,work_revision,completion_version,principal_id,note) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING created_at',
          [
            id,
            context.projectId,
            taskId,
            task.work_revision,
            task.completion_version,
            context.principalId,
            input.note ?? '',
          ],
        );
        if (!added.rowCount) throw new DomainError('TASK_ALREADY_VALIDATED');
        await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
        const version = task.version + 1;
        const projectSeq = await this.event(client, context, taskId, 'task.validated', {
          version,
          validationId: id,
          workRevision: task.work_revision,
          completionVersion: task.completion_version,
          note: input.note ?? '',
        });
        return {
          id,
          version,
          status: 'DONE' as const,
          workRevision: task.work_revision,
          completionVersion: task.completion_version,
          validatedBy: context.principalId,
          validatedAt: added.rows[0]!.created_at,
          projectSeq,
        };
      },
    );
  }

  private async reconcileDependencyState(
    client: pg.PoolClient,
    context: CommandContext,
    task: LockedTask,
    causeId: string,
    alertOnDone: boolean,
  ) {
    const met = await this.dependenciesMet(client, context, task.id);
    if (!met && task.status === 'DONE' && alertOnDone) {
      await client.query(
        'INSERT INTO task_alerts(id,project_id,task_id,depends_on,reason) VALUES ($1,$2,$3,$4,$5)',
        [randomUUID(), context.projectId, task.id, causeId, 'DEPENDENCY_REOPENED'],
      );
      await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [task.id]);
      const projectSeq = await this.event(client, context, task.id, 'task.dependencyAlert', {
        version: task.version + 1,
        dependsOn: causeId,
      });
      return { version: task.version + 1, status: task.status, projectSeq };
    }
    const block =
      !met && ['BACKLOG', 'READY', 'IN_PROGRESS', 'IN_REVIEW', 'IN_QA'].includes(task.status);
    const unblock = met && task.status === 'BLOCKED' && !task.manual_blocked;
    if (!block && !unblock) return { version: task.version, status: task.status };
    const status: TaskStatus = block ? 'BLOCKED' : 'READY';
    if (block) {
      await this.invalidateClaim(client, task.id);
      await this.invalidateApprovals(client, task.id);
    }
    await client.query('UPDATE work_items SET status=$2,version=version+1 WHERE id=$1', [
      task.id,
      status,
    ]);
    const version = task.version + 1;
    const projectSeq = await this.event(
      client,
      context,
      task.id,
      block ? 'task.dependencyBlocked' : 'task.dependencyUnblocked',
      { version, from: task.status, to: status, dependsOn: causeId },
    );
    return { version, status, projectSeq };
  }

  private async reconcileDependents(
    client: pg.PoolClient,
    context: CommandContext,
    taskId: string,
    lostCompletion: boolean,
  ): Promise<void> {
    const dependents = await client.query<{ task_id: string }>(
      'SELECT task_id FROM task_dependencies WHERE project_id=$1 AND depends_on=$2 ORDER BY task_id',
      [context.projectId, taskId],
    );
    for (const dependent of dependents.rows) {
      const task = await this.lockTask(client, context, dependent.task_id);
      await this.reconcileDependencyState(client, context, task, taskId, lostCompletion);
    }
  }

  async changeDependency(context: CommandContext, key: string, taskId: string, payload: unknown) {
    const input = dependencySchema.parse(payload);
    return this.command(
      context,
      'task.dependency',
      key,
      { taskId, ...input },
      async (client, actor) => {
        this.requireRole(actor, ['OWNER', 'ADMIN', 'MANAGER']);
        const task = await this.lockTask(client, context, taskId);
        this.assertMutable(task);
        this.assertVersion(task, input.expectedVersion);
        const dependency = await client.query(
          'SELECT id FROM work_items WHERE project_id=$1 AND id=$2',
          [context.projectId, input.dependsOn],
        );
        if (!dependency.rowCount) throw new DomainError('TASK_NOT_FOUND');
        if (input.operation === 'ADD') {
          const cycle = await client.query(
            `WITH RECURSIVE reachable(id) AS (
          SELECT $2::uuid UNION SELECT d.depends_on FROM task_dependencies d JOIN reachable r ON d.task_id=r.id WHERE d.project_id=$1
        ) SELECT id FROM reachable WHERE id=$3`,
            [context.projectId, input.dependsOn, taskId],
          );
          if (cycle.rowCount) throw new DomainError('DEPENDENCY_CYCLE');
          const added = await client.query(
            'INSERT INTO task_dependencies(project_id,task_id,depends_on) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING task_id',
            [context.projectId, taskId, input.dependsOn],
          );
          if (!added.rowCount) throw new DomainError('DEPENDENCY_EXISTS');
        } else {
          const removed = await client.query(
            'DELETE FROM task_dependencies WHERE project_id=$1 AND task_id=$2 AND depends_on=$3 RETURNING task_id',
            [context.projectId, taskId, input.dependsOn],
          );
          if (!removed.rowCount) throw new DomainError('DEPENDENCY_NOT_FOUND');
        }
        await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [taskId]);
        const projectSeq = await this.event(client, context, taskId, 'task.dependencyChanged', {
          version: task.version + 1,
          dependsOn: input.dependsOn,
          operation: input.operation,
          reason: input.reason,
        });
        if (
          ['IN_PROGRESS', 'IN_REVIEW', 'IN_QA'].includes(task.status) &&
          (await this.dependenciesMet(client, context, taskId))
        ) {
          await this.invalidateClaim(client, taskId);
          await this.invalidateApprovals(client, taskId);
          await client.query("UPDATE work_items SET status='READY',version=version+1 WHERE id=$1", [
            taskId,
          ]);
          const version = task.version + 2;
          const replannedSeq = await this.event(client, context, taskId, 'task.scopeReplanned', {
            version,
            from: task.status,
            to: 'READY',
            reason: input.reason,
          });
          return { version, status: 'READY' as const, projectSeq: replannedSeq };
        }
        const result = await this.reconcileDependencyState(
          client,
          context,
          { ...task, version: task.version + 1 },
          input.dependsOn,
          false,
        );
        return { ...result, projectSeq: result.projectSeq ?? projectSeq };
      },
      true,
    );
  }

  async registerSession(context: CommandContext, key: string, payload: unknown) {
    const input = emptyCommandSchema.parse(payload);
    return this.command(context, 'session.register', key, input, async (client) => {
      const id = randomUUID();
      const row = await client.query<{ expires_at: Date }>(
        'INSERT INTO agent_sessions(id,project_id,principal_id) VALUES ($1,$2,$3) RETURNING expires_at',
        [id, context.projectId, context.principalId],
      );
      const projectSeq = await this.event(
        client,
        context,
        id,
        'session.registered',
        { version: 1 },
        id,
        'SESSION',
      );
      return { id, version: 1, expiresAt: row.rows[0]!.expires_at.toISOString(), projectSeq };
    });
  }

  async heartbeatSession(
    context: CommandContext,
    key: string,
    sessionId: string,
    payload: unknown,
  ) {
    const input = sessionHeartbeatSchema.parse(payload);
    return this.command(
      context,
      'session.heartbeat',
      key,
      { sessionId, ...input },
      async (client) => {
        const result = await client.query<{ version: number }>(
          'SELECT version FROM agent_sessions WHERE project_id=$1 AND id=$2 AND principal_id=$3 AND ended_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE',
          [context.projectId, sessionId, context.principalId],
        );
        const row = result.rows[0];
        if (!row) throw new DomainError('SESSION_INACTIVE');
        if (row.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
        const updated = await client.query<{ expires_at: Date }>(
          "UPDATE agent_sessions SET expires_at=clock_timestamp()+interval '30 minutes',version=version+1 WHERE id=$1 RETURNING expires_at",
          [sessionId],
        );
        const version = row.version + 1;
        const projectSeq = await this.event(
          client,
          context,
          sessionId,
          'session.heartbeat',
          { version },
          sessionId,
          'SESSION',
        );
        return {
          id: sessionId,
          version,
          expiresAt: updated.rows[0]!.expires_at.toISOString(),
          projectSeq,
        };
      },
    );
  }

  async endSession(context: CommandContext, key: string, sessionId: string, payload: unknown) {
    const input = revokeClaimSchema.parse(payload);
    return this.command(
      context,
      'session.end',
      key,
      { sessionId, ...input },
      async (client, actor) => {
        const found = await client.query<{
          principal_id: string;
          version: number;
          ended_at: Date | null;
        }>(
          'SELECT principal_id,version,ended_at FROM agent_sessions WHERE project_id=$1 AND id=$2',
          [context.projectId, sessionId],
        );
        const logical = found.rows[0];
        if (!logical) throw new DomainError('SESSION_NOT_FOUND');
        if (logical.principal_id !== context.principalId)
          this.requireRole(actor, ['OWNER', 'ADMIN']);
        if (logical.ended_at) throw new DomainError('SESSION_INACTIVE');
        if (logical.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
        // Exclusive graph lock excludes claim writers before collecting affected tasks.
        const tasks = await client.query<{ id: string; version: number }>(
          'SELECT w.id,w.version FROM work_items w JOIN task_claims c ON c.task_id=w.id WHERE c.project_id=$1 AND c.session_id=$2 AND NOT c.revoked ORDER BY w.id FOR UPDATE OF w',
          [context.projectId, sessionId],
        );
        await client.query(
          'UPDATE agent_sessions SET ended_at=clock_timestamp(),version=version+1 WHERE id=$1',
          [sessionId],
        );
        for (const task of tasks.rows) {
          await this.invalidateClaim(client, task.id);
          await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [task.id]);
          await this.event(client, context, task.id, 'claim.revoked', {
            version: task.version + 1,
            reason: 'SESSION_ENDED',
            sessionId,
          });
        }
        const version = logical.version + 1;
        const projectSeq = await this.event(
          client,
          context,
          sessionId,
          'session.ended',
          { version, reason: input.reason },
          null,
          'SESSION',
        );
        return { id: sessionId, version, projectSeq };
      },
      true,
    );
  }

  async revokeAgentAccess(
    context: CommandContext,
    key: string,
    principalId: string,
    payload: unknown,
  ) {
    const input = revokeClaimSchema.parse(payload);
    return this.command(
      context,
      'agent.revokeAccess',
      key,
      { principalId, ...input },
      async (client, actor) => {
        this.requireRole(actor, ['OWNER', 'ADMIN']);
        const found = await client.query<{ version: number; active: boolean }>(
          "SELECT m.version,m.active FROM project_members m JOIN principals p ON p.id=m.principal_id WHERE m.project_id=$1 AND m.principal_id=$2 AND p.kind='AGENT' FOR UPDATE OF m",
          [context.projectId, principalId],
        );
        const member = found.rows[0];
        if (!member) throw new DomainError('AGENT_NOT_FOUND');
        if (member.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
        if (!member.active) throw new DomainError('AGENT_ACCESS_REVOKED');
        const tasks = await client.query<{ id: string; version: number }>(
          'SELECT w.id,w.version FROM work_items w JOIN task_claims c ON c.task_id=w.id WHERE c.project_id=$1 AND c.principal_id=$2 AND NOT c.revoked ORDER BY w.id FOR UPDATE OF w',
          [context.projectId, principalId],
        );
        await client.query(
          'UPDATE project_members SET active=false,version=version+1 WHERE project_id=$1 AND principal_id=$2',
          [context.projectId, principalId],
        );
        await client.query(
          'UPDATE agent_sessions SET ended_at=clock_timestamp(),version=version+1 WHERE project_id=$1 AND principal_id=$2 AND ended_at IS NULL',
          [context.projectId, principalId],
        );
        for (const task of tasks.rows) {
          await this.invalidateClaim(client, task.id);
          await client.query('UPDATE work_items SET version=version+1 WHERE id=$1', [task.id]);
          await this.event(client, context, task.id, 'claim.revoked', {
            version: task.version + 1,
            reason: 'AGENT_ACCESS_REVOKED',
            principalId,
          });
        }
        const version = member.version + 1;
        const projectSeq = await this.event(
          client,
          context,
          principalId,
          'agent.accessRevoked',
          { version, reason: input.reason },
          null,
          'PRINCIPAL',
        );
        return { principalId, version, projectSeq };
      },
      true,
    );
  }
}
