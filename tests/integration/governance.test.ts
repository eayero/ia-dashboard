import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, CoordinationStore } from '../../packages/db/src/index.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { bootstrapLocal } from '../../apps/api/src/local-bootstrap.ts';
import { createApplication } from '../../apps/api/src/app.ts';
import { loadConfiguration } from '../../apps/api/src/config.ts';
import { Client, StreamableHTTPClientTransport } from '../../apps/api/test/mcp-client.ts';
import { ProjectQueries } from '../../apps/api/src/projects/queries.ts';
import { GovernanceQueries } from '../../apps/api/src/projects/governance-queries.ts';
import { responseModels } from '../../apps/api/src/openapi/models.ts';
const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const store = new CoordinationStore(pool);
let seed: Awaited<ReturnType<typeof bootstrapLocal>>;
before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
  seed = await bootstrapLocal(process.env, pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
const owner = () => ({
  projectId: seed.projectId,
  principalId: seed.principalId,
  channel: 'WEB' as const,
});
const worker = () => ({
  projectId: seed.projectId,
  principalId: seed.agents[0]!.principalId,
  channel: 'MCP' as const,
});
const question = () =>
  store.createQuestion(worker(), randomUUID(), {
    title: 'What should ship?',
    description: 'Choose a supported option',
    priority: 'CRITICAL',
  });
const decisionInput = {
  title: 'Storage',
  context: 'Durable project state',
  alternatives: ['PostgreSQL', 'Files'],
  choice: 'PostgreSQL',
  rationale: 'Transactional consistency',
};

test('questions preserve proposals and resolve exactly once only through a human', async () => {
  assert.ok('createQuestion' in store);
  const q = await question(),
    key = randomUUID();
  const payload = { expectedVersion: q.version, text: 'Use the approved approach' };
  const answer = await store.answerQuestion(worker(), key, q.id, payload);
  assert.deepEqual(await store.answerQuestion(worker(), key, q.id, payload), answer);
  const resolve = {
    expectedVersion: answer.version,
    answerId: answer.answerId,
    reason: 'Accept proposal',
  };
  await assert.rejects(store.resolveQuestion(worker(), randomUUID(), q.id, resolve), {
    code: 'FORBIDDEN',
  });
  const results = await Promise.allSettled(
    [1, 2].map(() => store.resolveQuestion(owner(), randomUUID(), q.id, resolve)),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await pool.query('SELECT status,accepted_answer_id FROM questions WHERE id=$1', [q.id]))
      .rows[0].status,
    'RESOLVED',
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM question_resolutions WHERE question_id=$1', [
        q.id,
      ])
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    pool.query("UPDATE question_answers SET text='Rewrite' WHERE id=$1", [answer.answerId]),
    { code: '55000' },
  );
});

async function scope() {
  const r = await store.createRequirement(owner(), randomUUID(), {
    title: 'Scope',
    description: 'Governance task scope',
    type: 'FUNCTIONAL',
  });
  const approved = await store.approveRequirement(owner(), randomUUID(), r.id, {
    expectedVersion: r.version,
    revision: 1,
  });
  let i = (await pool.query("SELECT id,version FROM iterations WHERE status='ACTIVE'")).rows[0];
  if (!i) {
    i = await store.createIteration(owner(), randomUUID(), {
      name: 'Governance',
      goal: 'Verify policy',
      startsOn: '2026-11-06',
      endsOn: '2026-11-20',
    });
    await store.transitionIteration(owner(), randomUUID(), i.id, {
      expectedVersion: i.version,
      to: 'ACTIVE',
      reason: 'Verify',
    });
  }
  await store.assignRequirementSprint(owner(), randomUUID(), r.id, {
    expectedVersion: approved.version,
    sprintId: i.id,
    reason: 'Plan',
  });
  const task = await store.createTask(worker(), randomUUID(), {
    title: 'Governed task',
    requirementIds: [r.id],
    primaryRequirementId: r.id,
    criteria: [{ id: 'c', description: 'Evidence', required: true }],
  });
  const ready = await store.transitionTask(worker(), randomUUID(), task.id, {
    expectedVersion: task.version,
    to: 'READY',
  });
  return { ...task, version: ready.version };
}
test('hard questions revoke work and resolving one cannot clear another hard blocker', async () => {
  const task = await scope(),
    q1 = await question(),
    q2 = await question();
  const session = await store.registerSession(worker(), randomUUID(), {});
  const claim = await store.claimTask(worker(), randomUUID(), task.id, {
    expectedVersion: task.version,
    sessionId: session.id,
  });
  const started = await store.startWork(worker(), randomUUID(), task.id, {
    expectedVersion: claim.version,
    sessionId: session.id,
    fencingToken: claim.fencingToken,
  });
  const l1 = await store.linkQuestion(owner(), randomUUID(), q1.id, {
    expectedVersion: q1.version,
    taskId: task.id,
    taskVersion: started.version,
    hard: true,
    operation: 'ADD',
    reason: 'Need human answer',
  });
  assert.equal(
    (await pool.query('SELECT status FROM work_items WHERE id=$1', [task.id])).rows[0].status,
    'BLOCKED',
  );
  assert.equal(
    (await pool.query('SELECT revoked FROM task_claims WHERE task_id=$1', [task.id])).rows[0]
      .revoked,
    true,
  );
  assert.ok(
    (await pool.query('SELECT ended_at FROM task_work_intervals WHERE id=$1', [started.id])).rows[0]
      .ended_at,
  );
  await store.linkQuestion(owner(), randomUUID(), q2.id, {
    expectedVersion: q2.version,
    taskId: task.id,
    taskVersion: l1.taskVersion!,
    hard: true,
    operation: 'ADD',
    reason: 'Second blocker',
  });
  const answer = await store.answerQuestion(owner(), randomUUID(), q1.id, {
    expectedVersion: l1.version,
    text: 'Confirmed',
  });
  await store.resolveQuestion(owner(), randomUUID(), q1.id, {
    expectedVersion: answer.version,
    answerId: answer.answerId,
    reason: 'Human confirmation',
  });
  assert.equal(
    (await pool.query('SELECT status FROM work_items WHERE id=$1', [task.id])).rows[0].status,
    'BLOCKED',
  );
  const q2v = (await pool.query('SELECT version FROM questions WHERE id=$1', [q2.id])).rows[0]
    .version;
  await store.changeQuestionStatus(owner(), randomUUID(), q2.id, {
    expectedVersion: q2v,
    to: 'CANCELLED',
    reason: 'No longer needed',
  });
  assert.equal(
    (await pool.query('SELECT status FROM work_items WHERE id=$1', [task.id])).rows[0].status,
    'READY',
  );
});

test('approved decision revisions supersede atomically and require separate human impact review', async () => {
  const task = await scope();
  const d = await store.createDecision(worker(), randomUUID(), {
    ...decisionInput,
    taskIds: [task.id],
  });
  await assert.rejects(
    store.approveDecision(worker(), randomUUID(), d.id, {
      expectedVersion: d.version,
      revision: 1,
      reason: 'Self approve',
    }),
    { code: 'FORBIDDEN' },
  );
  const approved = await store.approveDecision(owner(), randomUUID(), d.id, {
    expectedVersion: d.version,
    revision: 1,
    reason: 'Chosen',
  });
  const t = (
    await pool.query('SELECT version,work_revision FROM work_items WHERE id=$1', [task.id])
  ).rows[0];
  const evaluated = await store.evaluateDecisionImpact(owner(), randomUUID(), d.id, {
    expectedVersion: approved.version,
    taskId: task.id,
    taskVersion: t.version,
    revision: 1,
    reason: 'Scope checked',
  });
  const rev = await store.reviseDecision(worker(), randomUUID(), d.id, {
    ...decisionInput,
    choice: 'Files',
    expectedVersion: evaluated.version,
    reason: 'Alternative proposal',
  });
  assert.equal(
    (await pool.query('SELECT approved_revision FROM decisions WHERE id=$1', [d.id])).rows[0]
      .approved_revision,
    1,
  );
  await store.approveDecision(owner(), randomUUID(), d.id, {
    expectedVersion: rev.version,
    revision: 2,
    reason: 'Supersede',
  });
  const revisions = (
    await pool.query(
      'SELECT status FROM decision_revisions WHERE decision_id=$1 ORDER BY revision',
      [d.id],
    )
  ).rows;
  assert.deepEqual(
    revisions.map((r) => r.status),
    ['SUPERSEDED', 'APPROVED'],
  );
  assert.equal(
    (await pool.query('SELECT work_revision FROM work_items WHERE id=$1', [task.id])).rows[0]
      .work_revision,
    t.work_revision,
  );
  await assert.rejects(
    pool.query(
      "UPDATE decision_revisions SET choice='PostgreSQL' WHERE decision_id=$1 AND revision=2",
      [d.id],
    ),
    { code: '55000' },
  );
});

test('REST and official MCP expose proposals and reads but not human confirmation tools', async () => {
  const app = await createApplication(loadConfiguration(process.env), pool);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const client = new Client({ name: 'governance-test', version: '1.0.0' });
  try {
    const anonymous = await fetch(`${base}/api/v1/projects/${seed.projectId}/questions`);
    assert.equal(anonymous.status, 401);
    const headers = {
      authorization: `Bearer ${seed.agents[0]!.apiToken}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    };
    const response = await fetch(`${base}/api/v1/projects/${seed.projectId}/questions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'REST question',
        description: 'Proposal by authenticated agent',
        priority: 'HIGH',
      }),
    });
    assert.equal(response.status, 201);
    const created = (await response.json()).data;
    const detail = await fetch(
      `${base}/api/v1/projects/${seed.projectId}/questions/${created.id}`,
      { headers },
    );
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).data.creatorIdentity.principalId, worker().principalId);
    const denied = await fetch(
      `${base}/api/v1/projects/${seed.projectId}/questions/${created.id}/resolve`,
      {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': randomUUID() },
        body: JSON.stringify({
          expectedVersion: created.version,
          answerId: randomUUID(),
          reason: 'Agent cannot resolve',
        }),
      },
    );
    assert.equal(denied.status, 403);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
        requestInit: { headers: { authorization: `Bearer ${seed.agents[0]!.mcpToken}` } },
      }),
    );
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('acc_register_question'));
    assert.ok(names.includes('acc_register_decision'));
    assert.ok(!names.includes('acc_resolve_question'));
    assert.ok(!names.includes('acc_approve_decision'));
    const proposal = await client.callTool({
      name: 'acc_register_decision',
      arguments: { projectId: seed.projectId, idempotencyKey: randomUUID(), input: decisionInput },
    });
    assert.notEqual(proposal.isError, true);
  } finally {
    await client.close();
    await app.close();
  }
});

test('claim racing a hard question never retains work after the question is linked', async () => {
  const task = await scope(),
    q = await question(),
    session = await store.registerSession(worker(), randomUUID(), {});
  const [claim, linked] = await Promise.allSettled([
    store.claimTask(worker(), randomUUID(), task.id, {
      expectedVersion: task.version,
      sessionId: session.id,
    }),
    store.linkQuestion(owner(), randomUUID(), q.id, {
      expectedVersion: q.version,
      taskId: task.id,
      taskVersion: task.version,
      hard: true,
      operation: 'ADD',
      reason: 'Concurrent blocker',
    }),
  ]);
  if (linked.status === 'rejected') {
    assert.equal(linked.reason.code, 'VERSION_CONFLICT');
    const version = (await pool.query('SELECT version FROM work_items WHERE id=$1', [task.id]))
      .rows[0].version;
    await store.linkQuestion(owner(), randomUUID(), q.id, {
      expectedVersion: q.version,
      taskId: task.id,
      taskVersion: version,
      hard: true,
      operation: 'ADD',
      reason: 'Retry after conflict',
    });
  }
  assert.equal(
    (await pool.query('SELECT status FROM work_items WHERE id=$1', [task.id])).rows[0].status,
    'BLOCKED',
  );
  if (claim.status === 'fulfilled')
    assert.equal(
      (await pool.query('SELECT revoked FROM task_claims WHERE task_id=$1', [task.id])).rows[0]
        .revoked,
      true,
    );
});

test('cross-project links are rejected atomically and DONE receives alerts without reopening', async () => {
  const other = randomUUID();
  await pool.query("INSERT INTO projects(id,name) VALUES ($1,'Other governance project')", [other]);
  await pool.query(
    'INSERT INTO project_members(project_id,principal_id,roles,scopes) SELECT $1,principal_id,roles,scopes FROM project_members WHERE project_id=$2',
    [other, seed.projectId],
  );
  const foreign = await store.createQuestion({ ...worker(), projectId: other }, randomUUID(), {
    title: 'Foreign question',
    description: 'Isolated scope',
  });
  await assert.rejects(
    store.createDecision(worker(), randomUUID(), { ...decisionInput, questionIds: [foreign.id] }),
    { code: 'QUESTION_NOT_FOUND' },
  );
  const task = await scope(),
    q = await question();
  await assert.rejects(
    store.linkQuestion({ ...owner(), projectId: other }, randomUUID(), q.id, {
      expectedVersion: q.version,
      taskId: task.id,
      taskVersion: task.version,
      hard: true,
      operation: 'ADD',
      reason: 'Foreign link',
    }),
    { code: 'QUESTION_NOT_FOUND' },
  );
  await pool.query("UPDATE work_items SET status='DONE',completion_version=version WHERE id=$1", [
    task.id,
  ]);
  await store.linkQuestion(owner(), randomUUID(), q.id, {
    expectedVersion: q.version,
    taskId: task.id,
    taskVersion: task.version,
    hard: true,
    operation: 'ADD',
    reason: 'Concern after completion',
  });
  assert.equal(
    (await pool.query('SELECT status FROM work_items WHERE id=$1', [task.id])).rows[0].status,
    'DONE',
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM question_task_alerts WHERE task_id=$1', [
        task.id,
      ])
    ).rows[0].n,
    1,
  );
});

test('human governance commands require CSRF and viewers cannot approve proposals', async () => {
  const config = loadConfiguration(process.env),
    app = await createApplication(config, pool);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  try {
    let r = await fetch(base + '/api/v1/auth/session');
    let csrf = (await r.json()).data.csrfToken;
    let cookie = r.headers
      .getSetCookie()
      .find((c) => c.startsWith('acc.sid='))!
      .split(';')[0]!;
    r = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers: {
        cookie,
        origin: config.publicOrigin,
        'x-csrf-token': csrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: seed.username, password: seed.password }),
    });
    assert.equal(r.status, 201);
    cookie = r.headers
      .getSetCookie()
      .find((c) => c.startsWith('acc.sid='))!
      .split(';')[0]!;
    r = await fetch(base + '/api/v1/auth/session', { headers: { cookie } });
    csrf = (await r.json()).data.csrfToken;
    const d = await store.createDecision(worker(), randomUUID(), decisionInput),
      path = base + `/api/v1/projects/${seed.projectId}/decisions/${d.id}/approve`,
      body = JSON.stringify({
        expectedVersion: d.version,
        revision: 1,
        reason: 'Confirm proposal',
      });
    r = await fetch(path, {
      method: 'POST',
      headers: {
        cookie,
        origin: config.publicOrigin,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body,
    });
    assert.equal(r.status, 403);
    await pool.query(
      "UPDATE project_members SET roles=ARRAY['VIEWER'] WHERE project_id=$1 AND principal_id=$2",
      [seed.projectId, seed.principalId],
    );
    try {
      r = await fetch(path, {
        method: 'POST',
        headers: {
          cookie,
          origin: config.publicOrigin,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          'x-csrf-token': csrf,
        },
        body,
      });
      assert.equal(r.status, 403);
    } finally {
      await pool.query(
        "UPDATE project_members SET roles=ARRAY['OWNER'] WHERE project_id=$1 AND principal_id=$2",
        [seed.projectId, seed.principalId],
      );
    }
  } finally {
    await app.close();
  }
});

test('governance cursors bind resource, principal, filters and exact signature shape', async () => {
  const queries = new GovernanceQueries(new ProjectQueries(pool, 'x'.repeat(32)), 'x'.repeat(32));
  const page = await queries.list(seed.projectId, seed.principalId, 'questions', { limit: 1 });
  assert.ok(page.nextCursor);
  for (const [principal, kind, input] of [
    [seed.principalId, 'questions', { cursor: page.nextCursor + '.extra' }],
    [worker().principalId, 'questions', { cursor: page.nextCursor }],
    [seed.principalId, 'decisions', { cursor: page.nextCursor }],
    [seed.principalId, 'questions', { cursor: page.nextCursor, priority: 'LOW' }],
  ] as const)
    await assert.rejects(queries.list(seed.projectId, principal, kind, input), {
      code: 'CURSOR_INVALID',
    });
});

test('question and decision read payloads match their explicit OpenAPI models', async () => {
  const queries = new GovernanceQueries(new ProjectQueries(pool, 'x'.repeat(32)), 'x'.repeat(32));
  const questions = await queries.list(seed.projectId, seed.principalId, 'questions', {
    limit: 100,
  });
  const decisions = await queries.list(seed.projectId, seed.principalId, 'decisions', {
    limit: 100,
  });
  const wire = (value: unknown) => JSON.parse(JSON.stringify(value));
  responseModels.QuestionList.parse(wire(questions));
  responseModels.DecisionList.parse(wire(decisions));
  responseModels.QuestionDetail.parse(
    wire(
      await queries.detail(seed.projectId, seed.principalId, 'questions', questions.items[0]!.id),
    ),
  );
  responseModels.DecisionDetail.parse(
    wire(
      await queries.detail(seed.projectId, seed.principalId, 'decisions', decisions.items[0]!.id),
    ),
  );
});

test('manual blocks survive question resolution and manager downgrade forbids approved-command replay', async () => {
  const task = await scope(),
    q = await question(),
    session = await store.registerSession(worker(), randomUUID(), {});
  const claim = await store.claimTask(worker(), randomUUID(), task.id, {
    expectedVersion: task.version,
    sessionId: session.id,
  });
  const manual = await store.transitionTask(worker(), randomUUID(), task.id, {
    expectedVersion: claim.version,
    sessionId: session.id,
    fencingToken: claim.fencingToken,
    to: 'BLOCKED',
    reason: 'Manual concern',
  });
  const linked = await store.linkQuestion(owner(), randomUUID(), q.id, {
    expectedVersion: q.version,
    taskId: task.id,
    taskVersion: manual.version,
    hard: true,
    operation: 'ADD',
    reason: 'Additional question',
  });
  await store.changeQuestionStatus(owner(), randomUUID(), q.id, {
    expectedVersion: linked.version,
    to: 'CANCELLED',
    reason: 'No longer needed',
  });
  assert.equal(
    (await pool.query('SELECT status FROM work_items WHERE id=$1', [task.id])).rows[0].status,
    'BLOCKED',
  );
  const d = await store.createDecision(worker(), randomUUID(), decisionInput),
    key = randomUUID(),
    input = { expectedVersion: d.version, revision: 1, reason: 'Human approval' };
  await store.approveDecision(owner(), key, d.id, input);
  await pool.query(
    "UPDATE project_members SET roles=ARRAY['REVIEWER'] WHERE project_id=$1 AND principal_id=$2",
    [seed.projectId, seed.principalId],
  );
  try {
    await assert.rejects(store.approveDecision(owner(), key, d.id, input), { code: 'FORBIDDEN' });
  } finally {
    await pool.query(
      "UPDATE project_members SET roles=ARRAY['OWNER'] WHERE project_id=$1 AND principal_id=$2",
      [seed.projectId, seed.principalId],
    );
  }
});

test('question and decision creation roll back with failed outbox; foreign answers cannot resolve', async () => {
  const q = await question(),
    other = await question();
  const answer = await store.answerQuestion(worker(), randomUUID(), other.id, {
    expectedVersion: other.version,
    text: 'Different question',
  });
  await assert.rejects(
    store.resolveQuestion(owner(), randomUUID(), q.id, {
      expectedVersion: q.version,
      answerId: answer.answerId,
      reason: 'Wrong answer',
    }),
    { code: 'ANSWER_NOT_FOUND' },
  );
  const before = (await pool.query('SELECT count(*)::int AS n FROM questions')).rows[0].n;
  await pool.query(
    "CREATE FUNCTION fail_governance_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END $$",
  );
  await pool.query(
    'CREATE TRIGGER fail_governance_outbox BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION fail_governance_outbox()',
  );
  try {
    await assert.rejects(question());
    await assert.rejects(store.createDecision(worker(), randomUUID(), decisionInput));
  } finally {
    await pool.query('DROP TRIGGER fail_governance_outbox ON event_outbox');
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM questions')).rows[0].n, before);
});

test('decision impact is enforced at productive transitions while a draft cannot replace the baseline', async () => {
  const task = await scope(),
    session = await store.registerSession(worker(), randomUUID(), {}),
    claim = await store.claimTask(worker(), randomUUID(), task.id, {
      expectedVersion: task.version,
      sessionId: session.id,
    });
  const d = await store.createDecision(worker(), randomUUID(), {
    ...decisionInput,
    taskIds: [task.id],
  });
  await store.approveDecision(owner(), randomUUID(), d.id, {
    expectedVersion: d.version,
    revision: 1,
    reason: 'Confirm policy',
  });
  const current = (await pool.query('SELECT version FROM work_items WHERE id=$1', [task.id]))
    .rows[0];
  await assert.rejects(
    store.transitionTask(worker(), randomUUID(), task.id, {
      expectedVersion: current.version,
      sessionId: session.id,
      fencingToken: claim.fencingToken,
      to: 'IN_REVIEW',
    }),
    { code: 'IMPACT_REVIEW_REQUIRED' },
  );
});
