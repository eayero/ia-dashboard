import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, CoordinationStore } from '../../packages/db/src/index.ts';
import * as db from '../../packages/db/src/index.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { seedAgentOwner } from '../../apps/api/test/agent-owner-fixture.ts';
import { ProjectQueries } from '../../apps/api/src/projects/queries.ts';
const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL }),
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 20,
  }),
  store = new CoordinationStore(pool);
before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
const fails = (code: string) => (e: unknown) =>
  Boolean(e && typeof e === 'object' && 'code' in e && e.code === code);
async function fixture() {
  const projectId = randomUUID(),
    ownerId = randomUUID(),
    agentId = randomUUID();
  await pool.query("INSERT INTO projects(id,name) VALUES ($1,'Time QA')", [projectId]);
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN'),($2,'AGENT')", [
    ownerId,
    agentId,
  ]);
  await seedAgentOwner(pool, agentId, ownerId);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles,scopes) VALUES ($1,$2,ARRAY['OWNER'],'{}'),($1,$3,'{}',ARRAY['task:read','task:write'])",
    [projectId, ownerId, agentId],
  );
  const owner = { projectId, principalId: ownerId },
    agent = { projectId, principalId: agentId };
  const task = await store.createTask(owner, randomUUID(), {
    title: 'Trabajo cronometrado',
    criteria: [{ id: 'a', description: 'OK', required: true }],
  });
  const ready = await store.transitionTask(owner, randomUUID(), task.id, {
    expectedVersion: 1,
    to: 'READY',
  });
  const session = await store.registerSession(agent, randomUUID(), {}),
    claim = await store.claimTask(agent, randomUUID(), task.id, {
      expectedVersion: ready.version,
      sessionId: session.id,
    });
  return {
    owner,
    agent,
    taskId: task.id,
    session,
    lease: {
      sessionId: session.id,
      fencingToken: claim.fencingToken,
      expectedVersion: claim.version,
    },
  };
}
async function report(f: Awaited<ReturnType<typeof fixture>>, timeZone = 'America/Caracas') {
  const client = await pool.connect();
  try {
    return await db.readTaskWorkTime(client, f.agent.projectId, f.taskId, timeZone);
  } finally {
    client.release();
  }
}
test('inicio/pausa explícitos acumulan intervalos sin duplicar reintentos', async () => {
  assert.equal(typeof store.startWork, 'function');
  const f = await fixture(),
    key = randomUUID();
  const started = await store.startWork(f.agent, key, f.taskId, f.lease);
  assert.deepEqual(await store.startWork(f.agent, key, f.taskId, f.lease), started);
  const paused = await store.pauseWork(f.agent, randomUUID(), f.taskId, {
    ...f.lease,
    expectedVersion: started.version,
  });
  const resumed = await store.startWork(f.agent, randomUUID(), f.taskId, {
    ...f.lease,
    expectedVersion: paused.version,
  });
  await store.pauseWork(f.agent, randomUUID(), f.taskId, {
    ...f.lease,
    expectedVersion: resumed.version,
  });
  const data = await report(f);
  assert.equal(data.intervals.length, 2);
  assert.equal(data.agents.length, 1);
  assert.ok(BigInt(data.totalMilliseconds) >= 0n);
  assert.equal(
    data.days.reduce((n, d) => n + BigInt(d.milliseconds), 0n),
    BigInt(data.totalMilliseconds),
  );
  await assert.rejects(
    pool.query(
      "UPDATE task_work_intervals SET started_at=started_at-interval '1 hour' WHERE task_id=$1",
      [f.taskId],
    ),
  );
});
test('dos inicios concurrentes producen un tramo y liberar claim cierra el contador', async () => {
  const f = await fixture();
  const results = await Promise.allSettled(
    [1, 2].map(() => store.startWork(f.agent, randomUUID(), f.taskId, f.lease)),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const row = (await pool.query('SELECT * FROM task_work_intervals WHERE task_id=$1', [f.taskId]))
    .rows[0];
  await pool.query(
    "INSERT INTO task_work_intervals(id,project_id,task_id,principal_id,session_id,fencing_token,agent_name,owner_user_id,started_at,valid_until,ended_at,close_reason) SELECT $1,project_id,task_id,principal_id,session_id,fencing_token,agent_name,owner_user_id,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '1 minute','PAUSED' FROM task_work_intervals WHERE id=$2",
    [randomUUID(), row.id],
  );
  const started = results.find((r) => r.status === 'fulfilled');
  assert.ok(started?.status === 'fulfilled');
  await store.releaseClaim(f.agent, randomUUID(), f.taskId, {
    ...f.lease,
    expectedVersion: started.value.version,
  });
  const data = await report(f);
  assert.ok(data.intervals.every((i) => i.state !== 'RUNNING'));
});
test('vencimiento limita tiempo y heartbeat no reanuda un tramo caducado', async () => {
  const f = await fixture();
  const start = await store.startWork(f.agent, randomUUID(), f.taskId, f.lease);
  await pool.query(
    "UPDATE task_work_intervals SET valid_until=started_at+interval '1 millisecond' WHERE id=$1",
    [start.id],
  );
  const before = await report(f);
  assert.equal(before.intervals[0]!.state, 'EXPIRED');
  assert.equal(before.totalMilliseconds, '1');
  const heartbeat = await store.heartbeatClaim(f.agent, randomUUID(), f.taskId, {
    ...f.lease,
    expectedVersion: start.version,
  });
  assert.equal((await report(f)).totalMilliseconds, '1');
  const resumed = await store.startWork(f.agent, randomUUID(), f.taskId, {
    ...f.lease,
    expectedVersion: heartbeat.version,
  });
  const data = await report(f);
  assert.equal(data.intervals.length, 2);
  assert.equal(data.intervals[0]!.closeReason, 'LEASE_EXPIRED');
  await store.pauseWork(f.agent, randomUUID(), f.taskId, {
    ...f.lease,
    expectedVersion: resumed.version,
  });
});
test('humanos y fencing ajeno no controlan el tiempo de un agente', async () => {
  const f = await fixture();
  await assert.rejects(
    store.startWork(f.owner, randomUUID(), f.taskId, f.lease),
    fails('FORBIDDEN'),
  );
  await assert.rejects(
    store.startWork(f.agent, randomUUID(), f.taskId, { ...f.lease, fencingToken: '999' }),
    fails('STALE_CLAIM'),
  );
  const started = await store.startWork(f.agent, randomUUID(), f.taskId, f.lease);
  await assert.rejects(
    store.pauseWork(f.agent, randomUUID(), f.taskId, {
      ...f.lease,
      expectedVersion: started.version,
      fencingToken: '999',
    }),
    fails('STALE_CLAIM'),
  );
});
test('terminar sesión cierra tramo y fallo de outbox revierte el inicio', async () => {
  const f = await fixture();
  await store.startWork(f.agent, randomUUID(), f.taskId, f.lease);
  await store.endSession(f.agent, randomUUID(), f.session.id, {
    expectedVersion: f.session.version,
    reason: 'Terminar trabajo',
  });
  assert.equal((await report(f)).intervals[0]!.state, 'CLOSED');
  const other = await fixture();
  await pool.query(
    "CREATE FUNCTION fail_time_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox unavailable'; END; $$; CREATE TRIGGER fail_time_outbox BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION fail_time_outbox()",
  );
  try {
    await assert.rejects(store.startWork(other.agent, randomUUID(), other.taskId, other.lease));
  } finally {
    await pool.query('DROP TRIGGER fail_time_outbox ON event_outbox');
  }
  assert.equal((await report(other)).totalMilliseconds, '0');
});
test('día local reparte medianoche y horario de verano sin duplicar duraciones', async () => {
  const f = await fixture();
  for (const [start, end] of [
    ['2026-01-02T03:30:00Z', '2026-01-02T04:30:00Z'],
    ['2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z'],
  ])
    await pool.query(
      "INSERT INTO task_work_intervals(id,project_id,task_id,principal_id,session_id,fencing_token,agent_name,owner_user_id,started_at,valid_until,ended_at,close_reason) VALUES ($1,$2,$3,$4,$5,$6,'Agente QA',$7,$8,$9,$9,'PAUSED')",
      [
        randomUUID(),
        f.agent.projectId,
        f.taskId,
        f.agent.principalId,
        f.session.id,
        f.lease.fencingToken,
        f.owner.principalId,
        start,
        end,
      ],
    );
  const local = await report(f);
  assert.equal(local.totalMilliseconds, '7200000');
  assert.equal(local.days.find((d) => d.date === '2026-01-01')!.milliseconds, '1800000');
  assert.equal(local.days.find((d) => d.date === '2026-01-02')!.milliseconds, '1800000');
  const dst = await report(f, 'America/New_York');
  assert.equal(dst.totalMilliseconds, '7200000');
  assert.equal(dst.days.find((d) => d.date === '2026-03-08')!.milliseconds, '3600000');
});
test('día de 25 horas y tramo de varios días conservan sumas exactas', async () => {
  const f = await fixture();
  for (const [start, end] of [
    ['2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
    ['2026-01-03T03:00:00Z', '2026-01-05T05:00:00Z'],
  ])
    await pool.query(
      "INSERT INTO task_work_intervals(id,project_id,task_id,principal_id,session_id,fencing_token,agent_name,owner_user_id,started_at,valid_until,ended_at,close_reason) VALUES ($1,$2,$3,$4,$5,$6,'Agente QA',$7,$8,$9,$9,'PAUSED')",
      [
        randomUUID(),
        f.agent.projectId,
        f.taskId,
        f.agent.principalId,
        f.session.id,
        f.lease.fencingToken,
        f.owner.principalId,
        start,
        end,
      ],
    );
  const ny = await report(f, 'America/New_York');
  assert.equal(ny.days.find((d) => d.date === '2026-11-01')!.milliseconds, '90000000');
  const local = await report(f);
  assert.equal(local.totalMilliseconds, '270000000');
  assert.equal(
    local.days.reduce((n, d) => n + BigInt(d.milliseconds), 0n),
    270000000n,
  );
});
test('un agente no acumula dos tareas simultáneas y revocarlo conserva su historial', async () => {
  const f = await fixture();
  const first = await store.startWork(f.agent, randomUUID(), f.taskId, f.lease);
  const other = await store.createTask(f.owner, randomUUID(), {
    title: 'Otra tarea',
    criteria: [{ id: 'a', description: 'OK', required: true }],
  });
  const ready = await store.transitionTask(f.owner, randomUUID(), other.id, {
    expectedVersion: 1,
    to: 'READY',
  });
  const secondClaim = await store.claimTask(f.agent, randomUUID(), other.id, {
    expectedVersion: ready.version,
    sessionId: f.session.id,
  });
  await assert.rejects(
    store.startWork(f.agent, randomUUID(), other.id, {
      expectedVersion: secondClaim.version,
      sessionId: f.session.id,
      fencingToken: secondClaim.fencingToken,
    }),
    fails('WORK_ALREADY_RUNNING'),
  );
  await store.revokeAgentAccess(f.owner, randomUUID(), f.agent.principalId, {
    expectedVersion: 1,
    reason: 'Retirar acceso del agente',
  });
  const data = await report(f);
  assert.equal(data.intervals[0]!.id, first.id);
  assert.equal(data.intervals[0]!.state, 'CLOSED');
  assert.equal(data.agents[0]!.principalId, f.agent.principalId);
  const queries = new ProjectQueries(pool, 'time ACL test');
  await assert.rejects(
    queries.taskTime(f.agent.projectId, f.agent.principalId, f.taskId, {}),
    fails('FORBIDDEN'),
  );
});
test('consulta de tiempo rechaza agentes y tareas de otro proyecto', async () => {
  const f = await fixture(),
    other = await fixture(),
    queries = new ProjectQueries(pool, 'time ACL test');
  await assert.rejects(
    queries.taskTime(f.agent.projectId, other.agent.principalId, f.taskId, {}),
    fails('FORBIDDEN'),
  );
  await assert.rejects(
    queries.taskTime(other.owner.projectId, other.owner.principalId, f.taskId, {}),
    fails('TASK_NOT_FOUND'),
  );
});
