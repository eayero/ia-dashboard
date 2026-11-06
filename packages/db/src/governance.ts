import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DomainError } from '@acc/domain';
import {
  createQuestionSchema,
  reviseQuestionSchema,
  answerQuestionSchema,
  resolveQuestionSchema,
  questionStatusSchema,
  linkQuestionSchema,
  createDecisionSchema,
  reviseDecisionSchema,
  approveDecisionSchema,
  linkDecisionSchema,
  evaluateDecisionImpactSchema,
} from '@acc/contracts';
export const governanceSchemas = {
  createQuestion: createQuestionSchema,
  reviseQuestion: reviseQuestionSchema,
  answerQuestion: answerQuestionSchema,
  resolveQuestion: resolveQuestionSchema,
  changeQuestionStatus: questionStatusSchema,
  linkQuestion: linkQuestionSchema,
  createDecision: createDecisionSchema,
  reviseDecision: reviseDecisionSchema,
  approveDecision: approveDecisionSchema,
  linkDecision: linkDecisionSchema,
  evaluateDecisionImpact: evaluateDecisionImpactSchema,
};
export type GovernanceOperation = keyof typeof governanceSchemas;
type Env = {
  client: pg.PoolClient;
  projectId: string;
  principalId: string;
  counter: (kind: 'Q' | 'DEC') => Promise<string>;
  event: (
    id: string,
    action: string,
    payload: Record<string, unknown>,
    type: 'TASK' | 'QUESTION' | 'DECISION',
  ) => Promise<string>;
  questionTask: (id: string, questionId: string) => Promise<number>;
};
async function requireResource(
  env: Env,
  table: 'questions' | 'requirements' | 'work_items',
  id: string,
) {
  const row = (
    await env.client.query(`SELECT id FROM ${table} WHERE project_id=$1 AND id=$2`, [
      env.projectId,
      id,
    ])
  ).rows[0];
  if (!row)
    throw new DomainError(
      table === 'questions'
        ? 'QUESTION_NOT_FOUND'
        : table === 'requirements'
          ? 'REQUIREMENT_NOT_FOUND'
          : 'TASK_NOT_FOUND',
    );
}
async function taskVersion(env: Env, id: string, expected: number) {
  const task = (
    await env.client.query(
      'SELECT version FROM work_items WHERE project_id=$1 AND id=$2 FOR UPDATE',
      [env.projectId, id],
    )
  ).rows[0];
  if (!task) throw new DomainError('TASK_NOT_FOUND');
  if (task.version !== expected) throw new DomainError('VERSION_CONFLICT');
}
async function decisionRevision(
  env: Env,
  id: string,
  revision: number,
  input: {
    title: string;
    context: string;
    alternatives: string[];
    choice: string;
    rationale: string;
  },
  reason: string,
) {
  await env.client.query(
    "INSERT INTO decision_revisions(project_id,decision_id,revision,title,context,alternatives,choice,rationale,reason,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10)",
    [
      env.projectId,
      id,
      revision,
      input.title,
      input.context,
      JSON.stringify(input.alternatives),
      input.choice,
      input.rationale,
      reason,
      env.principalId,
    ],
  );
}
async function links(
  env: Env,
  id: string,
  kind: 'question' | 'decision',
  input: { taskIds: string[]; requirementIds: string[]; questionIds?: string[] },
) {
  for (const task of input.taskIds) {
    await requireResource(env, 'work_items', task);
    await env.client.query(
      `INSERT INTO ${kind}_task_links(project_id,${kind}_id,task_id) VALUES ($1,$2,$3)`,
      [env.projectId, id, task],
    );
  }
  for (const requirement of input.requirementIds) {
    await requireResource(env, 'requirements', requirement);
    await env.client.query(
      `INSERT INTO ${kind}_requirement_links(project_id,${kind}_id,requirement_id) VALUES ($1,$2,$3)`,
      [env.projectId, id, requirement],
    );
  }
  for (const q of input.questionIds ?? []) {
    await requireResource(env, 'questions', q);
    await env.client.query(
      'INSERT INTO decision_question_links(project_id,decision_id,question_id) VALUES ($1,$2,$3)',
      [env.projectId, id, q],
    );
  }
}
export type GovernanceResult = {
  id: string;
  version: number;
  publicId?: string;
  revision?: number;
  approvedRevision?: number | null;
  projectSeq?: string;
  answerId?: string;
  taskVersion?: number;
};
export async function governanceCommand(
  env: Env,
  op: GovernanceOperation,
  id: string | null,
  payload: unknown,
): Promise<GovernanceResult> {
  const { client, projectId, principalId } = env;
  if (op === 'createQuestion' || op === 'createDecision') {
    const input =
        op === 'createQuestion'
          ? createQuestionSchema.parse(payload)
          : createDecisionSchema.parse(payload),
      kind = op === 'createQuestion' ? 'question' : 'decision',
      table = kind === 'question' ? 'questions' : 'decisions';
    if (input.externalRef) {
      const previous = (
        await client.query(
          `SELECT id,public_id AS "publicId",version FROM ${table} WHERE project_id=$1 AND external_ref=$2`,
          [projectId, input.externalRef],
        )
      ).rows[0];
      if (previous) return previous as { id: string; publicId: string; version: number };
    }
    const entityId = randomUUID(),
      publicId = `${kind === 'question' ? 'Q' : 'DEC'}-${await env.counter(kind === 'question' ? 'Q' : 'DEC')}`;
    if (op === 'createQuestion') {
      const q = createQuestionSchema.parse(input);
      await client.query(
        'INSERT INTO questions(id,project_id,public_id,external_ref,title,description,priority,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          entityId,
          projectId,
          publicId,
          q.externalRef ?? null,
          q.title,
          q.description,
          q.priority,
          principalId,
        ],
      );
    } else {
      const d = createDecisionSchema.parse(input);
      await client.query(
        'INSERT INTO decisions(id,project_id,public_id,external_ref,created_by) VALUES ($1,$2,$3,$4,$5)',
        [entityId, projectId, publicId, d.externalRef ?? null, principalId],
      );
      await decisionRevision(env, entityId, 1, d, 'Initial proposal');
    }
    await links(env, entityId, kind, input);
    const projectSeq = await env.event(
      entityId,
      `${kind}.created`,
      { ...input, version: 1, publicId },
      kind === 'question' ? 'QUESTION' : 'DECISION',
    );
    return { id: entityId, publicId, version: 1, revision: 1, projectSeq };
  }
  if (
    [
      'reviseQuestion',
      'answerQuestion',
      'resolveQuestion',
      'changeQuestionStatus',
      'linkQuestion',
    ].includes(op)
  ) {
    const q = (
      await client.query('SELECT * FROM questions WHERE project_id=$1 AND id=$2 FOR UPDATE', [
        projectId,
        id,
      ])
    ).rows[0];
    if (!q) throw new DomainError('QUESTION_NOT_FOUND');
    const parsed = governanceSchemas[op].parse(payload);
    if (!('expectedVersion' in parsed) || parsed.expectedVersion !== q.version)
      throw new DomainError('VERSION_CONFLICT');
    let answerId: string | undefined, taskVer: number | undefined;
    if (op === 'reviseQuestion') {
      if (q.status !== 'OPEN') throw new DomainError('QUESTION_NOT_OPEN');
      const v = reviseQuestionSchema.parse(parsed);
      await client.query(
        'UPDATE questions SET title=$3,description=$4,priority=$5 WHERE project_id=$1 AND id=$2',
        [projectId, id, v.title, v.description, v.priority],
      );
    } else if (op === 'answerQuestion') {
      if (q.status !== 'OPEN') throw new DomainError('QUESTION_NOT_OPEN');
      const v = answerQuestionSchema.parse(parsed);
      answerId = randomUUID();
      await client.query(
        'INSERT INTO question_answers(id,project_id,question_id,text,created_by) VALUES ($1,$2,$3,$4,$5)',
        [answerId, projectId, id, v.text, principalId],
      );
    } else if (op === 'resolveQuestion') {
      if (q.status !== 'OPEN') throw new DomainError('QUESTION_NOT_OPEN');
      const v = resolveQuestionSchema.parse(parsed);
      const answer = await client.query(
        'SELECT 1 FROM question_answers WHERE project_id=$1 AND question_id=$2 AND id=$3',
        [projectId, id, v.answerId],
      );
      if (!answer.rowCount) throw new DomainError('ANSWER_NOT_FOUND');
      answerId = v.answerId;
      await client.query(
        "UPDATE questions SET status='RESOLVED',accepted_answer_id=$3 WHERE project_id=$1 AND id=$2",
        [projectId, id, answerId],
      );
      await client.query(
        "INSERT INTO question_resolutions(id,project_id,question_id,answer_id,action,reason,principal_id) VALUES ($1,$2,$3,$4,'RESOLVE',$5,$6)",
        [randomUUID(), projectId, id, answerId, v.reason, principalId],
      );
    } else if (op === 'changeQuestionStatus') {
      const v = questionStatusSchema.parse(parsed);
      if (q.status === v.to) throw new DomainError('INVALID_TRANSITION');
      await client.query(
        'UPDATE questions SET status=$3,accepted_answer_id=NULL WHERE project_id=$1 AND id=$2',
        [projectId, id, v.to],
      );
      await client.query(
        'INSERT INTO question_resolutions(id,project_id,question_id,action,reason,principal_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), projectId, id, v.to === 'OPEN' ? 'REOPEN' : 'CANCEL', v.reason, principalId],
      );
    } else {
      const v = linkQuestionSchema.parse(parsed);
      await taskVersion(env, v.taskId, v.taskVersion);
      if (v.operation === 'ADD')
        await client.query(
          'INSERT INTO question_task_links(project_id,question_id,task_id,hard) VALUES ($1,$2,$3,$4) ON CONFLICT(project_id,question_id,task_id) DO UPDATE SET hard=EXCLUDED.hard',
          [projectId, id, v.taskId, v.hard],
        );
      else {
        const deleted = await client.query(
          'DELETE FROM question_task_links WHERE project_id=$1 AND question_id=$2 AND task_id=$3',
          [projectId, id, v.taskId],
        );
        if (!deleted.rowCount) throw new DomainError('QUESTION_LINK_NOT_FOUND');
      }
      taskVer = await env.questionTask(v.taskId, id!);
    }
    if (op === 'resolveQuestion' || op === 'changeQuestionStatus') {
      const affected = (
        await client.query<{ task_id: string }>(
          'SELECT task_id FROM question_task_links WHERE project_id=$1 AND question_id=$2 AND hard ORDER BY task_id',
          [projectId, id],
        )
      ).rows;
      for (const t of affected) await env.questionTask(t.task_id, id!);
    }
    await client.query('UPDATE questions SET version=version+1 WHERE project_id=$1 AND id=$2', [
      projectId,
      id,
    ]);
    const projectSeq = await env.event(
      id!,
      `question.${op}`,
      { ...parsed, version: q.version + 1, ...(answerId ? { answerId } : {}) },
      'QUESTION',
    );
    return {
      id: id!,
      version: q.version + 1,
      projectSeq,
      ...(answerId ? { answerId } : {}),
      ...(taskVer === undefined ? {} : { taskVersion: taskVer }),
    };
  }
  const d = (
    await client.query('SELECT * FROM decisions WHERE project_id=$1 AND id=$2 FOR UPDATE', [
      projectId,
      id,
    ])
  ).rows[0];
  if (!d) throw new DomainError('DECISION_NOT_FOUND');
  const parsed = governanceSchemas[op].parse(payload);
  if (!('expectedVersion' in parsed) || parsed.expectedVersion !== d.version)
    throw new DomainError('VERSION_CONFLICT');
  let revision = d.current_revision as number,
    approvedRevision = d.approved_revision as number | null,
    taskVer: number | undefined;
  if (op === 'reviseDecision') {
    const input = reviseDecisionSchema.parse(parsed);
    revision++;
    await decisionRevision(env, id!, revision, input, input.reason);
    await client.query('UPDATE decisions SET current_revision=$3 WHERE project_id=$1 AND id=$2', [
      projectId,
      id,
      revision,
    ]);
  } else if (op === 'approveDecision') {
    const input = approveDecisionSchema.parse(parsed);
    if (input.revision !== revision) throw new DomainError('DECISION_REVISION_CONFLICT');
    const current = (
      await client.query(
        'SELECT status FROM decision_revisions WHERE project_id=$1 AND decision_id=$2 AND revision=$3',
        [projectId, id, revision],
      )
    ).rows[0];
    if (current.status !== 'DRAFT') throw new DomainError('DECISION_ALREADY_APPROVED');
    if (approvedRevision !== null)
      await client.query(
        "UPDATE decision_revisions SET status='SUPERSEDED' WHERE project_id=$1 AND decision_id=$2 AND revision=$3",
        [projectId, id, approvedRevision],
      );
    await client.query(
      "UPDATE decision_revisions SET status='APPROVED',approved_by=$4,approved_at=clock_timestamp() WHERE project_id=$1 AND decision_id=$2 AND revision=$3",
      [projectId, id, revision, principalId],
    );
    approvedRevision = revision;
    await client.query('UPDATE decisions SET approved_revision=$3 WHERE project_id=$1 AND id=$2', [
      projectId,
      id,
      revision,
    ]);
    const tasks = (
      await client.query<{ task_id: string; status: string }>(
        'SELECT l.task_id,w.status FROM decision_task_links l JOIN work_items w ON w.project_id=l.project_id AND w.id=l.task_id WHERE l.project_id=$1 AND l.decision_id=$2 ORDER BY l.task_id FOR UPDATE OF w',
        [projectId, id],
      )
    ).rows;
    for (const t of tasks) {
      const row = (
        await client.query(
          'UPDATE work_items SET version=version+1 WHERE project_id=$1 AND id=$2 RETURNING version',
          [projectId, t.task_id],
        )
      ).rows[0];
      if (t.status === 'DONE')
        await client.query(
          'INSERT INTO decision_impact_alerts(id,project_id,decision_id,task_id,revision) VALUES ($1,$2,$3,$4,$5)',
          [randomUUID(), projectId, id, t.task_id, revision],
        );
      await env.event(
        t.task_id,
        'task.decisionImpactPending',
        { decisionId: id, revision, version: row.version },
        'TASK',
      );
    }
  } else {
    const input =
      op === 'linkDecision'
        ? linkDecisionSchema.parse(parsed)
        : evaluateDecisionImpactSchema.parse(parsed);
    await taskVersion(env, input.taskId, input.taskVersion);
    if (op === 'linkDecision') {
      const v = linkDecisionSchema.parse(input);
      if (v.operation === 'ADD')
        await client.query(
          'INSERT INTO decision_task_links(project_id,decision_id,task_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [projectId, id, v.taskId],
        );
      else {
        const del = await client.query(
          'DELETE FROM decision_task_links WHERE project_id=$1 AND decision_id=$2 AND task_id=$3',
          [projectId, id, v.taskId],
        );
        if (!del.rowCount) throw new DomainError('DECISION_LINK_NOT_FOUND');
      }
    } else {
      const v = evaluateDecisionImpactSchema.parse(input);
      if (v.revision !== approvedRevision) throw new DomainError('DECISION_REVISION_CONFLICT');
      const updated = await client.query(
        'UPDATE decision_task_links SET evaluated_revision=$4 WHERE project_id=$1 AND decision_id=$2 AND task_id=$3',
        [projectId, id, v.taskId, v.revision],
      );
      if (!updated.rowCount) throw new DomainError('DECISION_LINK_NOT_FOUND');
      await client.query(
        'INSERT INTO decision_impact_reviews(id,project_id,decision_id,task_id,revision,reason,principal_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), projectId, id, v.taskId, v.revision, v.reason, principalId],
      );
    }
    const t = (
      await client.query(
        'UPDATE work_items SET version=version+1 WHERE project_id=$1 AND id=$2 RETURNING version',
        [projectId, input.taskId],
      )
    ).rows[0];
    taskVer = t.version;
    await env.event(
      input.taskId,
      `task.${op}`,
      { ...input, decisionId: id, version: taskVer },
      'TASK',
    );
  }
  await client.query('UPDATE decisions SET version=version+1 WHERE project_id=$1 AND id=$2', [
    projectId,
    id,
  ]);
  const projectSeq = await env.event(
    id!,
    `decision.${op}`,
    { ...parsed, version: d.version + 1, revision, approvedRevision },
    'DECISION',
  );
  return {
    id: id!,
    version: d.version + 1,
    revision,
    approvedRevision,
    projectSeq,
    ...(taskVer === undefined ? {} : { taskVersion: taskVer }),
  };
}

export async function decisionImpactPending(
  client: pg.PoolClient,
  projectId: string,
  taskId: string,
) {
  return Boolean(
    (
      await client.query(
        'SELECT 1 FROM decision_task_links l JOIN decisions d ON d.project_id=l.project_id AND d.id=l.decision_id WHERE l.project_id=$1 AND l.task_id=$2 AND d.approved_revision IS NOT NULL AND l.evaluated_revision IS DISTINCT FROM d.approved_revision LIMIT 1',
        [projectId, taskId],
      )
    ).rowCount,
  );
}
