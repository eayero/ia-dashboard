import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Pool, CoordinationStore } from '../../packages/db/src/index.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { bootstrapLocal } from '../../apps/api/src/local-bootstrap.ts';
import * as database from '../../packages/db/src/index.ts';
import { createApplication } from '../../apps/api/src/app.ts';
import { loadConfiguration } from '../../apps/api/src/config.ts';
import { Client, StreamableHTTPClientTransport } from '../../apps/api/test/mcp-client.ts';
import { PlanningQueries } from '../../apps/api/src/projects/planning-queries.ts';
import { ProjectQueries } from '../../apps/api/src/projects/queries.ts';

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
const owner = () => ({ projectId: seed.projectId, principalId: seed.principalId });
const agent = () => ({ projectId: seed.projectId, principalId: seed.agents[0]!.principalId });
async function sprint(name = 'Sprint') {
  const created = await store.createIteration(owner(), randomUUID(), {
    name,
    goal: 'Entrega comprobable',
    startsOn: '2026-11-05',
    endsOn: '2026-11-19',
  });
  assert.ok(created.id);
  return { ...created, id: created.id };
}
async function requirement() {
  const r = await store.createRequirement(owner(), randomUUID(), {
    title: 'Requisito',
    description: 'Implementar con trazabilidad',
    type: 'FUNCTIONAL',
  });
  const a = await store.approveRequirement(owner(), randomUUID(), r.id, {
    expectedVersion: r.version,
    revision: 1,
  });
  return { ...r, version: a.version };
}
test('migration adds iterations and composite primary relationship without inventing sprints', async () => {
  const found = await pool.query(
    "SELECT to_regclass(current_schema()||'.iterations')::text AS name",
  );
  assert.ok(found.rows[0].name, 'iterations migration must exist');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM iterations')).rows[0].n, 0);
});
test('sprint lifecycle guards actual task execution and preserves stopped work', async () => {
  const r = await requirement(),
    i = await sprint();
  await assert.rejects(
    store.createIteration(agent(), randomUUID(), {
      name: 'Denied',
      goal: 'x',
      startsOn: '2026-11-05',
      endsOn: '2026-11-06',
    }),
    { code: 'FORBIDDEN' },
  );
  const assigned = await store.assignRequirementSprint(owner(), randomUUID(), r.id, {
    expectedVersion: r.version,
    sprintId: i.id,
    reason: 'Planificar',
  });
  assert.ok(assigned.version > r.version);
  const task = await store.createTask(agent(), randomUUID(), {
    title: 'Ejecutar',
    requirementIds: [r.id],
    primaryRequirementId: r.id,
    criteria: [{ id: 'c1', description: 'Entrega', required: true }],
  });
  const ready = await store.transitionTask(agent(), randomUUID(), task.id, {
    expectedVersion: task.version,
    to: 'READY',
  });
  const session = await store.registerSession(agent(), randomUUID(), {});
  await assert.rejects(
    store.claimTask(agent(), randomUUID(), task.id, {
      expectedVersion: ready.version,
      sessionId: session.id,
    }),
    { code: 'SPRINT_NOT_ACTIVE' },
  );
  const active = await store.transitionIteration(owner(), randomUUID(), i.id, {
    expectedVersion: i.version,
    to: 'ACTIVE',
    reason: 'Iniciar',
  });
  const claim = await store.claimTask(agent(), randomUUID(), task.id, {
    expectedVersion: ready.version,
    sessionId: session.id,
  });
  const started = await store.startWork(agent(), randomUUID(), task.id, {
    expectedVersion: claim.version,
    sessionId: session.id,
    fencingToken: claim.fencingToken,
  });
  assert.ok(started.id);
  await assert.rejects(
    store.assignRequirementSprint(owner(), randomUUID(), r.id, {
      expectedVersion: assigned.version + 1,
      sprintId: null,
      reason: 'Mover',
    }),
    { code: 'ASSIGNMENT_WORK_ACTIVE' },
  );
  const paused = await store.transitionIteration(owner(), randomUUID(), i.id, {
    expectedVersion: active.version,
    to: 'PAUSED',
    reason: 'Pausa',
  });
  const interval = (
    await pool.query(
      'SELECT ended_at,close_reason,requirement_id,sprint_id FROM task_work_intervals WHERE id=$1',
      [started.id],
    )
  ).rows[0];
  assert.ok(interval.ended_at);
  assert.equal(interval.close_reason, 'SPRINT_STOPPED');
  assert.equal(interval.requirement_id, r.id);
  assert.equal(interval.sprint_id, i.id);
  assert.equal(
    (await pool.query('SELECT revoked FROM task_claims WHERE task_id=$1', [task.id])).rows[0]
      .revoked,
    true,
  );
  await assert.rejects(
    store.startWork(agent(), randomUUID(), task.id, {
      expectedVersion: started.version,
      sessionId: session.id,
      fencingToken: claim.fencingToken,
    }),
  );
  await store.transitionIteration(owner(), randomUUID(), i.id, {
    expectedVersion: paused.version,
    to: 'CANCELLED',
    reason: 'Fin de prueba',
  });
});
test('only one ACTIVE sprint survives concurrent activation, with immutable idempotent replay', async () => {
  const one = await sprint('Uno'),
    two = await sprint('Dos');
  const results = await Promise.allSettled(
    [one, two].map((i) =>
      store.transitionIteration(owner(), randomUUID(), i.id, {
        expectedVersion: i.version,
        to: 'ACTIVE',
        reason: 'Activar',
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'ACTIVE_SPRINT_EXISTS');
  const key = randomUUID(),
    payload = {
      name: 'Reintento',
      goal: 'Sin duplicados',
      startsOn: '2026-11-05',
      endsOn: '2026-11-06',
    };
  const first = await store.createIteration(owner(), key, payload);
  assert.deepEqual(await store.createIteration(owner(), key, payload), first);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1', [first.id]))
      .rows[0].n,
    1,
  );
});
test('authorship and participants use authenticated snapshots and successful actions without duplicate retries', async () => {
  assert.ok('readEntityAttribution' in database, 'attribution reader must exist');
  const context = { ...agent(), channel: 'MCP' as const },
    key = randomUUID();
  const input = { title: 'Autoria', description: 'Identidad del agente', type: 'FUNCTIONAL' };
  const r = await store.createRequirement(context, key, input);
  await store.createRequirement(context, key, input);
  const client = await pool.connect();
  try {
    const data = await database.readEntityAttribution(
      client,
      seed.projectId,
      r.id,
      'REQUIREMENT',
      'America/Caracas',
    );
    assert.equal(data.creator.identity?.principalId, context.principalId);
    assert.equal(data.creator.identity?.ownerUserId, seed.principalId);
    assert.equal(data.creator.channel, 'MCP');
    assert.equal(data.participants.length, 1);
    assert.equal(data.participants[0]!.actionCount, 1);
    assert.equal(data.participants[0]!.milliseconds, '0');
    assert.equal(data.totalMilliseconds, '0');
    await assert.rejects(
      database.readEntityAttribution(client, randomUUID(), r.id, 'REQUIREMENT', 'UTC'),
      { code: 'REQUIREMENT_NOT_FOUND' },
    );
  } finally {
    client.release();
  }
});

test('legacy participation gains a verified identity on a later action without rewriting old authorship', async () => {
  const context = { ...agent(), channel: 'MCP' as const };
  const r = await store.createRequirement(context, randomUUID(), {
    title: 'Legacy participant',
    description: 'Unknown identity until a verified action',
    type: 'FUNCTIONAL',
  });
  const client = await pool.connect();
  try {
    // Isolated fixture: represent pre-012 provenance, without changing production history.
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
    await client.query(
      "UPDATE audit_events SET actor_identity=NULL,channel='UNKNOWN' WHERE entity_id=$1",
      [r.id],
    );
    await client.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
    await client.query('ALTER TABLE requirements DISABLE TRIGGER requirement_creator');
    await client.query('UPDATE requirements SET creator_identity=NULL WHERE id=$1', [r.id]);
    await client.query('ALTER TABLE requirements ENABLE TRIGGER requirement_creator');
    await client.query('COMMIT');
    const revision = {
      expectedVersion: r.version,
      title: 'Verified intervention',
      description: 'New authenticated action',
      type: 'FUNCTIONAL',
      reason: 'Resume historical entity',
    };
    const key = randomUUID();
    await store.reviseRequirement(context, key, r.id, revision);
    await store.reviseRequirement(context, key, r.id, revision);
    const data = await database.readEntityAttribution(
      client,
      seed.projectId,
      r.id,
      'REQUIREMENT',
      'UTC',
    );
    assert.equal(data.creator.identity, null);
    assert.equal(data.creator.channel, 'UNKNOWN');
    assert.equal(data.participants.length, 1);
    assert.equal(data.participants[0]!.identity?.principalId, context.principalId);
    assert.equal(data.participants[0]!.identity?.ownerUserId, seed.principalId);
    assert.equal(data.participants[0]!.actionCount, 2);
    assert.deepEqual(data.participants[0]!.channels, ['UNKNOWN', 'MCP']);
    assert.equal(
      (
        await client.query(
          'SELECT actor_identity FROM audit_events WHERE entity_id=$1 ORDER BY seq LIMIT 1',
          [r.id],
        )
      ).rows[0].actor_identity,
      null,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
test('REST and native MCP expose sprint and participants with shared authenticated identity', async () => {
  const config = loadConfiguration(process.env),
    app = await createApplication(config, pool);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const client = new Client({ name: 'planning-integration', version: '1.0.0' });
  try {
    const headers = { authorization: `Bearer ${seed.agents[0]!.mcpToken}` };
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers } }),
    );
    const tools = (await client.listTools()).tools;
    assert.ok(
      tools.some((t) => t.name === 'acc_list_iterations'),
      'sprint MCP read tool must exist',
    );
    assert.ok(tools.some((t) => t.name === 'acc_get_participants'));
    const list = await client.callTool({
      name: 'acc_list_iterations',
      arguments: { projectId: seed.projectId, query: { limit: 100 } },
    });
    assert.notEqual(list.isError, true);
    let r = await fetch(`${base}/api/v1/projects/${seed.projectId}/iterations`, {
      headers: { authorization: `Bearer ${seed.agents[0]!.apiToken}` },
    });
    assert.equal(r.status, 200);
    r = await fetch(base + '/api/v1/auth/session');
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
    r = await fetch(`${base}/api/v1/projects/${seed.projectId}/iterations`, {
      method: 'POST',
      headers: {
        cookie,
        origin: config.publicOrigin,
        'x-csrf-token': csrf,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        name: 'Sprint HTTP',
        goal: 'REST real',
        startsOn: '2026-11-05',
        endsOn: '2026-11-06',
      }),
    });
    assert.equal(r.status, 201);
    const audit = (
      await pool.query(
        "SELECT channel,actor_identity FROM audit_events WHERE action='iteration.created' ORDER BY seq DESC LIMIT 1",
      )
    ).rows[0];
    assert.equal(audit.channel, 'WEB');
    assert.equal(audit.actor_identity.principalId, seed.principalId);
    const req = await client.callTool({
      name: 'acc_register_requirement',
      arguments: {
        projectId: seed.projectId,
        idempotencyKey: randomUUID(),
        input: { title: 'MCP attribution', description: 'MCP actor', type: 'FUNCTIONAL' },
      },
    });
    const reqData = (req.structuredContent as { data: { id: string } }).data;
    const part = await client.callTool({
      name: 'acc_get_participants',
      arguments: {
        projectId: seed.projectId,
        query: { entityType: 'REQUIREMENT', entityId: reqData.id, timeZone: 'UTC' },
      },
    });
    assert.notEqual(part.isError, true);
    assert.equal(
      (part.structuredContent as { data: { creator: { channel: string } } }).data.creator.channel,
      'MCP',
    );
  } finally {
    await client.close();
    await app.close();
  }
});

test('signed sprint cursors reject trailing segments and principal/resource substitution', async () => {
  const queries = new PlanningQueries(new ProjectQueries(pool, 's'.repeat(32)), 's'.repeat(32));
  const first = await queries.iterations(seed.projectId, seed.principalId, { limit: 1 });
  assert.ok(first.nextCursor);
  await assert.rejects(
    queries.iterations(seed.projectId, seed.principalId, {
      limit: 1,
      cursor: first.nextCursor + '.extra',
    }),
    { code: 'CURSOR_INVALID' },
  );
  await assert.rejects(
    queries.iterations(seed.projectId, seed.agents[0]!.principalId, { cursor: first.nextCursor }),
    { code: 'CURSOR_INVALID' },
  );
});

test('historical creator channel is unknown when the creation event has no provenance', async () => {
  const r = await store.createRequirement({ ...owner(), channel: 'WEB' }, randomUUID(), {
    title: 'Legacy author',
    description: 'No creation provenance',
    type: 'FUNCTIONAL',
  });
  const client = await pool.connect();
  try {
    // A migration fixture represents a creator predating audit provenance.
    await client.query('ALTER TABLE requirements DISABLE TRIGGER requirement_creator');
    await client.query('UPDATE requirements SET creator_identity=NULL WHERE id=$1', [r.id]);
    await client.query('ALTER TABLE requirements ENABLE TRIGGER requirement_creator');
    const data = await database.readEntityAttribution(
      client,
      seed.projectId,
      r.id,
      'REQUIREMENT',
      'UTC',
    );
    assert.equal(data.creator.identity, null);
    assert.equal(data.creator.channel, 'UNKNOWN');
  } finally {
    await client.query('ALTER TABLE requirements ENABLE TRIGGER requirement_creator');
    client.release();
  }
});

async function executionScenario() {
  const projectId = randomUUID();
  await pool.query("INSERT INTO projects(id,name) VALUES($1,'Isolated sprint scenario')", [
    projectId,
  ]);
  await pool.query(
    'INSERT INTO project_members(project_id,principal_id,roles,scopes) SELECT $1,principal_id,roles,scopes FROM project_members WHERE project_id=$2',
    [projectId, seed.projectId],
  );
  const human = { ...owner(), projectId, channel: 'WEB' as const },
    worker = { ...agent(), projectId, channel: 'MCP' as const };
  const i = await store.createIteration(human, randomUUID(), {
    name: 'Execution scenario',
    goal: 'Preserve execution history',
    startsOn: '2026-11-05',
    endsOn: '2026-11-19',
  });
  assert.ok(i.id);
  const r = await store.createRequirement(human, randomUUID(), {
    title: 'Scenario scope',
    description: 'Primary execution scope',
    type: 'FUNCTIONAL',
  });
  const approved = await store.approveRequirement(human, randomUUID(), r.id, {
    expectedVersion: r.version,
    revision: 1,
  });
  await store.assignRequirementSprint(human, randomUUID(), r.id, {
    expectedVersion: approved.version,
    sprintId: i.id,
    reason: 'Plan scenario',
  });
  const active = await store.transitionIteration(human, randomUUID(), i.id, {
    expectedVersion: i.version,
    to: 'ACTIVE',
    reason: 'Start scenario',
  });
  const t = await store.createTask(worker, randomUUID(), {
    title: 'Scenario task',
    requirementIds: [r.id],
    primaryRequirementId: r.id,
    criteria: [{ id: 'c1', description: 'Verified', required: true }],
  });
  const ready = await store.transitionTask(worker, randomUUID(), t.id, {
    expectedVersion: t.version,
    to: 'READY',
  });
  const session = await store.registerSession(worker, randomUUID(), {});
  return {
    human,
    worker,
    i: { ...i, id: i.id, version: active.version! },
    r,
    t: { ...t, version: ready.version },
    session,
  };
}

test('concurrent sprint pause and claim never leave an executable claim', async () => {
  for (let n = 0; n < 5; n++) {
    const s = await executionScenario();
    const results = await Promise.allSettled([
      store.claimTask(s.worker, randomUUID(), s.t.id, {
        expectedVersion: s.t.version,
        sessionId: s.session.id,
      }),
      store.transitionIteration(s.human, randomUUID(), s.i.id, {
        expectedVersion: s.i.version,
        to: 'PAUSED',
        reason: 'Pause concurrently',
      }),
    ]);
    assert.equal(results[1]!.status, 'fulfilled');
    const claims = await pool.query(
      'SELECT * FROM task_claims WHERE project_id=$1 AND NOT revoked',
      [s.worker.projectId],
    );
    assert.equal(claims.rowCount, 0);
    const version = (await pool.query('SELECT version FROM work_items WHERE id=$1', [s.t.id]))
      .rows[0].version;
    await assert.rejects(
      store.claimTask(s.worker, randomUUID(), s.t.id, {
        expectedVersion: version,
        sessionId: s.session.id,
      }),
      { code: 'SPRINT_NOT_ACTIVE' },
    );
  }
});

test('requirement collaborators retain authenticated owner names alongside recorded intervals', async () => {
  const s = await executionScenario();
  const claim = await store.claimTask(s.worker, randomUUID(), s.t.id, {
    expectedVersion: s.t.version,
    sessionId: s.session.id,
  });
  const lease = { sessionId: s.session.id, fencingToken: claim.fencingToken };
  const started = await store.startWork(s.worker, randomUUID(), s.t.id, {
    expectedVersion: claim.version,
    ...lease,
  });
  await store.releaseClaim(s.worker, randomUUID(), s.t.id, {
    expectedVersion: started.version,
    ...lease,
  });
  const client = await pool.connect();
  try {
    const data = await database.readEntityAttribution(
      client,
      s.worker.projectId,
      s.r.id,
      'REQUIREMENT',
      'UTC',
    );
    const person = data.taskCollaborators.find((p) => p.principalId === s.worker.principalId);
    assert.ok(person);
    assert.equal(person.identity?.ownerUserId, seed.principalId);
    assert.equal(person.identity?.ownerUsername, seed.username);
    assert.equal(data.work.length, 1);
    assert.equal(person.milliseconds, data.totalMilliseconds);
  } finally {
    client.release();
  }
});

test('concurrent start and pause closes every interval and rejects stale writes', async () => {
  const s = await executionScenario();
  const claim = await store.claimTask(s.worker, randomUUID(), s.t.id, {
    expectedVersion: s.t.version,
    sessionId: s.session.id,
  });
  const lease = { sessionId: s.session.id, fencingToken: claim.fencingToken };
  const results = await Promise.allSettled([
    store.startWork(s.worker, randomUUID(), s.t.id, { expectedVersion: claim.version, ...lease }),
    store.transitionIteration(s.human, randomUUID(), s.i.id, {
      expectedVersion: s.i.version,
      to: 'PAUSED',
      reason: 'Pause during start',
    }),
  ]);
  assert.equal(results[1]!.status, 'fulfilled');
  assert.equal(
    (
      await pool.query('SELECT 1 FROM task_work_intervals WHERE task_id=$1 AND ended_at IS NULL', [
        s.t.id,
      ])
    ).rowCount,
    0,
  );
  const version = (await pool.query('SELECT version FROM work_items WHERE id=$1', [s.t.id])).rows[0]
    .version;
  for (const action of [
    () =>
      store.heartbeatClaim(s.worker, randomUUID(), s.t.id, { expectedVersion: version, ...lease }),
    () =>
      store.updateWork(s.worker, randomUUID(), s.t.id, {
        expectedVersion: version,
        ...lease,
        summary: 'Stale write',
      }),
    () =>
      store.addEvidence(s.worker, randomUUID(), s.t.id, {
        expectedVersion: version,
        ...lease,
        kind: 'OTHER',
        url: 'https://example.test/evidence',
        criterionIds: ['c1'],
      }),
  ])
    await assert.rejects(action, { code: 'SPRINT_NOT_ACTIVE' });
  // Stopping remains possible outside an active sprint.
  await store.endSession(s.worker, randomUUID(), s.session.id, {
    expectedVersion: s.session.version,
    reason: 'Stopped scenario',
  });
});

test('reassignment keeps historical time on the former principal requirement and sprint', async () => {
  const s = await executionScenario();
  const other = await store.createRequirement(s.human, randomUUID(), {
    title: 'Secondary scope',
    description: 'Does not determine sprint',
    type: 'FUNCTIONAL',
  });
  const link = await store.linkRequirement(s.human, randomUUID(), other.id, {
    expectedVersion: other.version,
    taskId: s.t.id,
    taskVersion: s.t.version,
    operation: 'ADD',
    reason: 'Secondary traceability',
  });
  const claim = await store.claimTask(s.worker, randomUUID(), s.t.id, {
    expectedVersion: link.taskVersion!,
    sessionId: s.session.id,
  });
  const lease = { sessionId: s.session.id, fencingToken: claim.fencingToken };
  const started = await store.startWork(s.worker, randomUUID(), s.t.id, {
    expectedVersion: claim.version,
    ...lease,
  });
  await assert.rejects(
    store.assignPrimaryRequirement(s.human, randomUUID(), s.t.id, {
      expectedVersion: started.version,
      requirementId: other.id,
      reason: 'Move while working',
    }),
    { code: 'ASSIGNMENT_WORK_ACTIVE' },
  );
  const released = await store.releaseClaim(s.worker, randomUUID(), s.t.id, {
    expectedVersion: started.version,
    ...lease,
  });
  const before = (await pool.query('SELECT * FROM task_work_intervals WHERE id=$1', [started.id]))
    .rows[0];
  const moved = await store.assignPrimaryRequirement(s.human, randomUUID(), s.t.id, {
    expectedVersion: released.version,
    requirementId: other.id,
    reason: 'Move to backlog',
  });
  const after = (await pool.query('SELECT * FROM task_work_intervals WHERE id=$1', [started.id]))
    .rows[0];
  assert.deepEqual(after, before);
  assert.equal(after.requirement_id, s.r.id);
  assert.equal(after.sprint_id, s.i.id);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM requirement_task_links WHERE task_id=$1', [
        s.t.id,
      ])
    ).rows[0].n,
    2,
  );
  await assert.rejects(
    store.claimTask(s.worker, randomUUID(), s.t.id, {
      expectedVersion: moved.version,
      sessionId: s.session.id,
    }),
    { code: 'SPRINT_REQUIRED' },
  );
  const client = await pool.connect();
  try {
    const old = await database.readEntityAttribution(
      client,
      s.worker.projectId,
      s.r.id,
      'REQUIREMENT',
      'UTC',
    );
    const secondary = await database.readEntityAttribution(
      client,
      s.worker.projectId,
      other.id,
      'REQUIREMENT',
      'UTC',
    );
    assert.ok(BigInt(old.totalMilliseconds) > 0n);
    assert.equal(secondary.totalMilliseconds, '0');
    assert.equal(old.work[0]!.principalId, s.worker.principalId);
  } finally {
    client.release();
  }
});

test('management replay checks current permissions and preparation preserves evidence and state', async () => {
  const s = await executionScenario(),
    key = randomUUID(),
    payload = {
      name: 'Managed',
      goal: 'Replay protection',
      startsOn: '2026-11-05',
      endsOn: '2026-11-06',
    };
  await store.createIteration(s.human, key, payload);
  await pool.query(
    "UPDATE project_members SET roles=ARRAY['REVIEWER'] WHERE project_id=$1 AND principal_id=$2",
    [s.human.projectId, s.human.principalId],
  );
  await assert.rejects(store.createIteration(s.human, key, payload), { code: 'FORBIDDEN' });
  await pool.query(
    "UPDATE project_members SET roles=ARRAY['OWNER'] WHERE project_id=$1 AND principal_id=$2",
    [s.human.projectId, s.human.principalId],
  );
  const claim = await store.claimTask(s.worker, randomUUID(), s.t.id, {
    expectedVersion: s.t.version,
    sessionId: s.session.id,
  });
  await store.startWork(s.worker, randomUUID(), s.t.id, {
    expectedVersion: claim.version,
    sessionId: s.session.id,
    fencingToken: claim.fencingToken,
  });
  const before = (
    await pool.query('SELECT status,work_revision,criteria FROM work_items WHERE id=$1', [s.t.id])
  ).rows[0];
  const prepared = await store.prepareSprintExecution(s.human, randomUUID(), {
    reason: 'Offline migration preparation',
  });
  assert.equal(prepared.tasksStopped, 1);
  assert.deepEqual(
    (await pool.query('SELECT status,work_revision,criteria FROM work_items WHERE id=$1', [s.t.id]))
      .rows[0],
    before,
  );
  assert.equal(
    (await pool.query('SELECT close_reason FROM task_work_intervals WHERE task_id=$1', [s.t.id]))
      .rows[0].close_reason,
    'SPRINT_PREPARATION',
  );
});

test('migration 012 preserves legacy rows and only backfills unambiguous primary links', async () => {
  const legacySchema = `acc_test_legacy_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${legacySchema}"`);
  const legacy = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${legacySchema}`,
  });
  try {
    const directory = new URL('../../packages/db/migrations/', import.meta.url);
    for (const name of (await readdir(directory))
      .filter((n) => /^0(?:0[1-9]|1[01])_/.test(n))
      .sort())
      await legacy.query(await readFile(new URL(name, directory), 'utf8'));
    const p = randomUUID(),
      h = randomUUID(),
      r1 = randomUUID(),
      r2 = randomUUID(),
      t1 = randomUUID(),
      t2 = randomUUID();
    await legacy.query("INSERT INTO projects(id,name) VALUES ($1,'Legacy')", [p]);
    await legacy.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [h]);
    await legacy.query(
      "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
      [p, h],
    );
    const client = await legacy.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO requirements(id,project_id,public_id,created_by) VALUES ($1,$3,'REQ-1',$4),($2,$3,'REQ-2',$4)",
        [r1, r2, p, h],
      );
      await client.query(
        "INSERT INTO requirement_revisions(project_id,requirement_id,revision,type,title,description,reason,status,created_by) VALUES ($1,$2,1,'FUNCTIONAL','One','Legacy one','Initial','DRAFT',$4),($1,$3,1,'FUNCTIONAL','Two','Legacy two','Initial','DRAFT',$4)",
        [p, r1, r2, h],
      );
      await client.query(
        `INSERT INTO work_items(id,project_id,public_id,title,criteria,created_by) VALUES ($1,$3,'TASK-1','Singleton','[{"id":"c"}]',$4),($2,$3,'TASK-2','Ambiguous','[{"id":"c"}]',$4)`,
        [t1, t2, p, h],
      );
      await client.query(
        'INSERT INTO requirement_task_links(project_id,requirement_id,task_id) VALUES ($1,$2,$4),($1,$2,$5),($1,$3,$5)',
        [p, r1, r2, t1, t2],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const before = (
      await legacy.query(
        'SELECT id,title,status,version,work_revision,created_by,created_at FROM work_items ORDER BY id',
      )
    ).rows;
    await legacy.query(await readFile(new URL('012_sprint_attribution.sql', directory), 'utf8'));
    assert.deepEqual(
      (
        await legacy.query(
          'SELECT id,title,status,version,work_revision,created_by,created_at FROM work_items ORDER BY id',
        )
      ).rows,
      before,
    );
    assert.equal(
      (await legacy.query('SELECT primary_requirement_id FROM work_items WHERE id=$1', [t1]))
        .rows[0].primary_requirement_id,
      r1,
    );
    assert.equal(
      (
        await legacy.query(
          'SELECT primary_requirement_id,creator_identity FROM work_items WHERE id=$1',
          [t2],
        )
      ).rows[0].primary_requirement_id,
      null,
    );
    assert.equal((await legacy.query('SELECT count(*)::int AS n FROM iterations')).rows[0].n, 0);
    await assert.rejects(
      legacy.query('UPDATE work_items SET created_by=$2 WHERE id=$1', [t1, randomUUID()]),
      { code: '55000' },
    );
  } finally {
    await legacy.end();
    await admin.query(`DROP SCHEMA "${legacySchema}" CASCADE`);
  }
});

test('concurrent pause and start leave no running work; reassignment preserves historical attribution', async () => {
  const active = (await pool.query("SELECT id,version FROM iterations WHERE status='ACTIVE'"))
    .rows[0];
  if (active)
    await store.transitionIteration(owner(), randomUUID(), active.id, {
      expectedVersion: active.version,
      to: 'PAUSED',
      reason: 'Separate race test',
    });
  const r = await requirement(),
    secondary = await requirement(),
    i = await sprint('Race');
  await store.assignRequirementSprint(owner(), randomUUID(), r.id, {
    expectedVersion: r.version,
    sprintId: i.id,
    reason: 'Plan race',
  });
  const task = await store.createTask({ ...agent(), channel: 'MCP' }, randomUUID(), {
    title: 'Race task',
    requirementIds: [r.id, secondary.id],
    primaryRequirementId: r.id,
    criteria: [{ id: 'c', description: 'Race invariant', required: true }],
  });
  const ready = await store.transitionTask(agent(), randomUUID(), task.id, {
    expectedVersion: task.version,
    to: 'READY',
  });
  const running = await store.transitionIteration(owner(), randomUUID(), i.id, {
    expectedVersion: i.version,
    to: 'ACTIVE',
    reason: 'Run',
  });
  const session = await store.registerSession(agent(), randomUUID(), {});
  const claim = await store.claimTask(agent(), randomUUID(), task.id, {
    expectedVersion: ready.version,
    sessionId: session.id,
  });
  // Ensure at least one historical span exists before exercising the race.
  await store.startWork(agent(), randomUUID(), task.id, {
    expectedVersion: claim.version,
    sessionId: session.id,
    fencingToken: claim.fencingToken,
  });
  const results = await Promise.allSettled([
    store.startWork(agent(), randomUUID(), task.id, {
      expectedVersion: claim.version,
      sessionId: session.id,
      fencingToken: claim.fencingToken,
    }),
    store.transitionIteration(owner(), randomUUID(), i.id, {
      expectedVersion: running.version,
      to: 'PAUSED',
      reason: 'Stop during start',
    }),
  ]);
  assert.equal(results[1]!.status, 'fulfilled');
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM task_work_intervals WHERE task_id=$1 AND ended_at IS NULL',
        [task.id],
      )
    ).rows[0].n,
    0,
  );
  const before = (await pool.query('SELECT * FROM task_work_intervals WHERE task_id=$1', [task.id]))
    .rows;
  const current = (
    await pool.query('SELECT version,work_revision FROM work_items WHERE id=$1', [task.id])
  ).rows[0];
  await store.assignPrimaryRequirement(owner(), randomUUID(), task.id, {
    expectedVersion: current.version,
    requirementId: secondary.id,
    reason: 'Reassign without rewriting time',
  });
  assert.deepEqual(
    (await pool.query('SELECT * FROM task_work_intervals WHERE task_id=$1', [task.id])).rows,
    before,
  );
  assert.equal(
    (await pool.query('SELECT work_revision FROM work_items WHERE id=$1', [task.id])).rows[0]
      .work_revision,
    current.work_revision,
  );
  const client = await pool.connect();
  try {
    const original = await database.readEntityAttribution(
      client,
      seed.projectId,
      r.id,
      'REQUIREMENT',
      'UTC',
    );
    const next = await database.readEntityAttribution(
      client,
      seed.projectId,
      secondary.id,
      'REQUIREMENT',
      'UTC',
    );
    assert.equal(original.work.length, 1);
    assert.equal(next.work.length, 0);
    assert.equal(original.work[0]!.sprintId, i.id);
  } finally {
    client.release();
  }
  await assert.rejects(
    pool.query('UPDATE work_items SET primary_requirement_id=$2 WHERE id=$1', [
      task.id,
      randomUUID(),
    ]),
    { code: '23503' },
  );
});
