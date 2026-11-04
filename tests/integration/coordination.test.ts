import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/db/src/migrate.ts';
import { Pool } from '../../packages/db/src/index.ts';
import { FixtureCoordinationStore as CoordinationStore } from '../../apps/api/test/task-requirement-fixture.ts';
import { seedAgentOwner } from '../../apps/api/test/agent-owner-fixture.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 20,
});
const store = new CoordinationStore(pool);
const projectId = randomUUID();
const principalId = randomUUID();
const sessionId = randomUUID();
const context = { projectId, principalId };
const ownerId = randomUUID();
const owner = { projectId, principalId: ownerId };
const taskInput = {
  title: 'Exclusividad',
  criteria: [{ id: 'AC-1', description: 'Un ejecutor', required: true }],
};
before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
  await pool.query('INSERT INTO principals(id, kind) VALUES ($1, $2)', [principalId, 'AGENT']);
  await pool.query('INSERT INTO projects(id, name) VALUES ($1, $2)', [
    projectId,
    'Synthetic integration',
  ]);
  await pool.query(
    'INSERT INTO project_members(project_id, principal_id, roles, scopes) VALUES ($1, $2, $3, $4)',
    [projectId, principalId, [], ['task:write']],
  );
  await pool.query('INSERT INTO agent_sessions(id, project_id, principal_id) VALUES ($1, $2, $3)', [
    sessionId,
    projectId,
    principalId,
  ]);
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [ownerId]);
  await seedAgentOwner(pool, principalId, ownerId);
  await pool.query('INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,$3)', [
    projectId,
    ownerId,
    ['OWNER'],
  ]);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

test('migraciones repetidas no cambian ni pierden datos', async () => {
  await migrate(pool);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count,
    10,
  );
  assert.equal(
    (await pool.query('SELECT name FROM projects WHERE id=$1', [projectId])).rows[0].name,
    'Synthetic integration',
  );
});
test('migración aplicada con checksum distinto detiene la ejecución', async () => {
  const original = (await pool.query('SELECT name,checksum FROM schema_migrations')).rows[0];
  await pool.query("UPDATE schema_migrations SET checksum='changed' WHERE name=$1", [
    original.name,
  ]);
  try {
    await assert.rejects(migrate(pool), /Migration checksum mismatch/u);
  } finally {
    await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE name=$2', [
      original.checksum,
      original.name,
    ]);
  }
});
test('100 reintentos idempotentes producen una tarea, un evento y un outbox', async () => {
  const results = await Promise.all(
    Array.from({ length: 100 }, () => store.createTask(context, 'create-race', taskInput)),
  );
  assert.equal(new Set(results.map((task) => task.id)).size, 1);
  const { rows } = await pool.query(
    'SELECT (SELECT count(*)::int FROM work_items WHERE id=$1) AS tasks, (SELECT count(*)::int FROM audit_events WHERE entity_id=$1) AS events, (SELECT count(*)::int FROM event_outbox o JOIN audit_events e ON e.id=o.event_id WHERE e.entity_id=$1) AS outbox',
    [results[0]!.id],
  );
  assert.deepEqual(rows[0], { tasks: 1, events: 1, outbox: 1 });
  await assert.rejects(
    store.createTask(context, 'create-race', { ...taskInput, title: 'Otro payload' }),
    { code: 'IDEMPOTENCY_KEY_REUSED' },
  );
});
test('100 claims concurrentes conceden una sola propiedad', async () => {
  const task = await store.createTask(context, randomUUID(), taskInput);
  // Fixture prepares planning; production will expose the authorized transition command.
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  const results = await Promise.allSettled(
    Array.from({ length: 100 }, () =>
      store.claimTask(context, randomUUID(), task.id, { sessionId, expectedVersion: 1 }),
    ),
  );
  const successes = results.filter((result) => result.status === 'fulfilled');
  assert.equal(successes.length, 1);
  assert.equal(
    results.filter(
      (result) => result.status === 'rejected' && result.reason.code === 'TASK_ALREADY_CLAIMED',
    ).length,
    99,
  );
  const lease = successes[0]!;
  if (lease.status !== 'fulfilled') throw new Error('No winning claim');
  assert.equal(lease.value.fencingToken, '1');
  assert.equal(lease.value.version, 2);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM task_claims WHERE task_id=$1', [task.id]))
      .rows[0].count,
    1,
  );
});
test('lease expirado se recupera con fencing mayor y el token anterior no renueva', async () => {
  const task = await store.createTask(context, randomUUID(), taskInput);
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  const first = await store.claimTask(context, randomUUID(), task.id, {
    sessionId,
    expectedVersion: 1,
  });
  await pool.query(
    "UPDATE task_claims SET expires_at=clock_timestamp()-interval '1 second' WHERE task_id=$1",
    [task.id],
  );
  const second = await store.claimTask(context, randomUUID(), task.id, {
    sessionId,
    expectedVersion: first.version,
  });
  assert.equal(second.fencingToken, '2');
  await assert.rejects(
    store.heartbeatClaim(context, randomUUID(), task.id, {
      sessionId,
      fencingToken: first.fencingToken,
      expectedVersion: second.version,
    }),
    { code: 'STALE_CLAIM' },
  );
  const renewed = await store.heartbeatClaim(context, randomUUID(), task.id, {
    sessionId,
    fencingToken: second.fencingToken,
    expectedVersion: second.version,
  });
  assert.equal(renewed.version, 4);
});
test('fencing vigente no permite versión anterior ni otra sesión', async () => {
  const task = await store.createTask(context, randomUUID(), taskInput);
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  const lease = await store.claimTask(context, randomUUID(), task.id, {
    sessionId,
    expectedVersion: 1,
  });
  await assert.rejects(
    store.heartbeatClaim(context, randomUUID(), task.id, {
      fencingToken: lease.fencingToken,
      sessionId,
      expectedVersion: 1,
    }),
    { code: 'VERSION_CONFLICT' },
  );
  const otherSession = randomUUID();
  await pool.query('INSERT INTO agent_sessions(id, project_id, principal_id) VALUES ($1,$2,$3)', [
    otherSession,
    projectId,
    principalId,
  ]);
  await assert.rejects(
    store.heartbeatClaim(context, randomUUID(), task.id, {
      fencingToken: lease.fencingToken,
      sessionId: otherSession,
      expectedVersion: lease.version,
    }),
    { code: 'STALE_CLAIM' },
  );
});
test('comando fallido revierte evento, outbox y registro idempotente', async () => {
  const task = await store.createTask(context, randomUUID(), taskInput);
  const key = randomUUID();
  await assert.rejects(store.claimTask(context, key, task.id, { sessionId, expectedVersion: 1 }), {
    code: 'INVALID_TRANSITION',
  });
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM idempotency_records WHERE key=$1', [key]))
      .rows[0].count,
    0,
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM audit_events WHERE entity_id=$1', [
        task.id,
      ])
    ).rows[0].count,
    1,
  );
});
test('fallo al insertar outbox revierte también tarea y secuencia', async () => {
  const key = randomUUID();
  const beforeCount = (await pool.query('SELECT count(*)::int AS count FROM work_items')).rows[0]
    .count;
  const beforeSeq = (
    await pool.query("SELECT value FROM project_counters WHERE project_id=$1 AND kind='EVENT'", [
      projectId,
    ])
  ).rows[0].value;
  await pool.query(
    "CREATE FUNCTION fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected outbox failure'; END; $$",
  );
  await pool.query(
    'CREATE TRIGGER fail_outbox_insert BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION fail_outbox()',
  );
  try {
    await assert.rejects(store.createTask(context, key, taskInput), /injected outbox failure/u);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS count FROM work_items')).rows[0].count,
      beforeCount,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT value FROM project_counters WHERE project_id=$1 AND kind='EVENT'",
          [projectId],
        )
      ).rows[0].value,
      beforeSeq,
    );
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS count FROM idempotency_records WHERE key=$1', [
          key,
        ])
      ).rows[0].count,
      0,
    );
  } finally {
    await pool.query('DROP TRIGGER fail_outbox_insert ON event_outbox');
    await pool.query('DROP FUNCTION fail_outbox()');
  }
});
test('external_ref mantiene identidad con claves idempotentes distintas', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      store.createTask(context, randomUUID(), { ...taskInput, externalRef: 'BOOT-EXACT' }),
    ),
  );
  assert.equal(new Set(results.map((task) => task.id)).size, 1);
});
test('sesión finalizada no renueva y permite recuperación por otra sesión', async () => {
  const endedSession = randomUUID();
  await pool.query('INSERT INTO agent_sessions(id,project_id,principal_id) VALUES ($1,$2,$3)', [
    endedSession,
    projectId,
    principalId,
  ]);
  const task = await store.createTask(context, randomUUID(), taskInput);
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  const first = await store.claimTask(context, randomUUID(), task.id, {
    sessionId: endedSession,
    expectedVersion: 1,
  });
  await pool.query('UPDATE agent_sessions SET ended_at=clock_timestamp() WHERE id=$1', [
    endedSession,
  ]);
  await assert.rejects(
    store.heartbeatClaim(context, randomUUID(), task.id, {
      sessionId: endedSession,
      fencingToken: first.fencingToken,
      expectedVersion: first.version,
    }),
    { code: 'SESSION_INACTIVE' },
  );
  const second = await store.claimTask(context, randomUUID(), task.id, {
    sessionId,
    expectedVersion: first.version,
  });
  assert.equal(second.fencingToken, '2');
});
test('membresía y claves compuestas impiden referencias cross-project', async () => {
  const foreignProject = randomUUID();
  await pool.query('INSERT INTO projects(id, name) VALUES ($1,$2)', [foreignProject, 'Other']);
  await assert.rejects(
    store.createTask({ ...context, projectId: foreignProject }, randomUUID(), taskInput),
    { code: 'FORBIDDEN' },
  );
  const task = await store.createTask(context, randomUUID(), taskInput);
  await assert.rejects(
    pool.query(
      'INSERT INTO task_claims(project_id, task_id, principal_id, session_id, fencing_token, expires_at) VALUES ($1,$2,$3,$4,1,clock_timestamp())',
      [foreignProject, task.id, principalId, sessionId],
    ),
    { code: '23503' },
  );
  await pool.query(
    'INSERT INTO project_members(project_id,principal_id,scopes) VALUES ($1,$2,$3)',
    [foreignProject, principalId, ['task:write']],
  );
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
    [foreignProject, ownerId],
  );
  await assert.rejects(
    store.claimTask({ ...context, projectId: foreignProject }, randomUUID(), task.id, {
      sessionId,
      expectedVersion: 1,
    }),
    { code: 'TASK_NOT_FOUND' },
  );
});
test('VIEWER y principal deshabilitado no crean tareas', async () => {
  const viewer = randomUUID();
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [viewer]);
  await pool.query(
    'INSERT INTO project_members(project_id,principal_id,roles,scopes) VALUES ($1,$2,$3,$4)',
    [projectId, viewer, ['VIEWER'], ['task:write']],
  );
  await assert.rejects(
    store.createTask({ ...context, principalId: viewer }, randomUUID(), taskInput),
    { code: 'FORBIDDEN' },
  );
  await pool.query('UPDATE principals SET disabled=true WHERE id=$1', [viewer]);
  await pool.query("UPDATE project_members SET roles=ARRAY['OWNER'] WHERE principal_id=$1", [
    viewer,
  ]);
  await assert.rejects(
    store.createTask({ ...context, principalId: viewer }, randomUUID(), taskInput),
    { code: 'FORBIDDEN' },
  );
});
test('proyecto pausado impide nuevos claims y archivado impide mutaciones', async () => {
  const task = await store.createTask(context, randomUUID(), taskInput);
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  await pool.query('UPDATE projects SET claims_paused=true WHERE id=$1', [projectId]);
  try {
    await assert.rejects(
      store.claimTask(context, randomUUID(), task.id, { sessionId, expectedVersion: 1 }),
      { code: 'CLAIMS_PAUSED' },
    );
  } finally {
    await pool.query('UPDATE projects SET claims_paused=false WHERE id=$1', [projectId]);
  }
  await pool.query('UPDATE projects SET archived=true WHERE id=$1', [projectId]);
  try {
    await assert.rejects(store.createTask(context, randomUUID(), taskInput), {
      code: 'PROJECT_ARCHIVED',
    });
  } finally {
    await pool.query('UPDATE projects SET archived=false WHERE id=$1', [projectId]);
  }
});
test('auditoría no se puede modificar ni borrar', async () => {
  await assert.rejects(pool.query("UPDATE audit_events SET action='rewritten'"), { code: '55000' });
  await assert.rejects(pool.query('DELETE FROM audit_events'), { code: '55000' });
  await assert.rejects(pool.query('TRUNCATE audit_events CASCADE'), { code: '55000' });
});

test('liberar exige propiedad vigente y permite recuperar sin reutilizar fencing', async () => {
  const task = await store.createTask(context, randomUUID(), taskInput);
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  const first = await store.claimTask(context, randomUUID(), task.id, {
    sessionId,
    expectedVersion: 1,
  });
  const payload = { sessionId, fencingToken: first.fencingToken, expectedVersion: first.version };
  await assert.rejects(store.releaseClaim(owner, randomUUID(), task.id, payload), {
    code: 'SESSION_INACTIVE',
  });
  const key = randomUUID();
  const released = await store.releaseClaim(context, key, task.id, payload);
  assert.deepEqual(await store.releaseClaim(context, key, task.id, payload), released);
  assert.equal(released.version, 3);
  await assert.rejects(
    store.heartbeatClaim(context, randomUUID(), task.id, { ...payload, expectedVersion: 3 }),
    { code: 'STALE_CLAIM' },
  );
  const next = await store.claimTask(context, randomUUID(), task.id, {
    sessionId,
    expectedVersion: 3,
  });
  assert.ok(BigInt(next.fencingToken) > BigInt(first.fencingToken));
});

test('revocar requiere OWNER/ADMIN, motivo y versión; invalida inmediatamente el token', async () => {
  const task = await store.createTask(context, randomUUID(), taskInput);
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  const first = await store.claimTask(context, randomUUID(), task.id, {
    sessionId,
    expectedVersion: 1,
  });
  const payload = { expectedVersion: first.version, reason: 'Cambio de responsable' };
  await assert.rejects(store.revokeClaim(context, randomUUID(), task.id, payload), {
    code: 'FORBIDDEN',
  });
  const revoked = await store.revokeClaim(owner, randomUUID(), task.id, payload);
  assert.equal(revoked.version, 3);
  const claim = (
    await pool.query('SELECT fencing_token,revoked FROM task_claims WHERE task_id=$1', [task.id])
  ).rows[0];
  assert.equal(claim.revoked, true);
  assert.equal(claim.fencing_token, '2');
  await assert.rejects(
    store.heartbeatClaim(context, randomUUID(), task.id, {
      sessionId,
      fencingToken: first.fencingToken,
      expectedVersion: 3,
    }),
    { code: 'STALE_CLAIM' },
  );
});

test('sesión ACC se registra idempotentemente con auditoría y heartbeat no renueva claims', async () => {
  const key = randomUUID();
  const logical = await store.registerSession(context, key, {});
  assert.deepEqual(await store.registerSession(context, key, {}), logical);
  const task = await store.createTask(context, randomUUID(), taskInput);
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  const claim = await store.claimTask(context, randomUUID(), task.id, {
    sessionId: logical.id,
    expectedVersion: 1,
  });
  const renewed = await store.heartbeatSession(context, randomUUID(), logical.id, {
    expectedVersion: logical.version,
  });
  assert.equal(renewed.version, 2);
  const stored = (
    await pool.query(
      'SELECT c.expires_at,w.version FROM task_claims c JOIN work_items w ON w.id=c.task_id WHERE c.task_id=$1',
      [task.id],
    )
  ).rows[0];
  assert.equal(stored.expires_at.toISOString(), claim.expiresAt);
  assert.equal(stored.version, claim.version);
  const audit = (
    await pool.query(
      "SELECT entity_type FROM audit_events WHERE entity_id=$1 AND action='session.registered'",
      [logical.id],
    )
  ).rows[0];
  assert.equal(audit.entity_type, 'SESSION');
});
test('terminar sesión invalida claims inmediatamente y permite recuperación por otra sesión', async () => {
  const logical = await store.registerSession(context, randomUUID(), {});
  const task = await store.createTask(context, randomUUID(), taskInput);
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  const first = await store.claimTask(context, randomUUID(), task.id, {
    sessionId: logical.id,
    expectedVersion: 1,
  });
  await store.endSession(context, randomUUID(), logical.id, {
    expectedVersion: 1,
    reason: 'Trabajo finalizado por la sesión',
  });
  await assert.rejects(
    store.heartbeatClaim(context, randomUUID(), task.id, {
      sessionId: logical.id,
      fencingToken: first.fencingToken,
      expectedVersion: 3,
    }),
    { code: 'SESSION_INACTIVE' },
  );
  const replacement = await store.registerSession(context, randomUUID(), {});
  const next = await store.claimTask(context, randomUUID(), task.id, {
    sessionId: replacement.id,
    expectedVersion: 3,
  });
  assert.ok(BigInt(next.fencingToken) > BigInt(first.fencingToken));
});
test('revocación de acceso concurrente con claim termina sin propiedad y sin deadlock', async () => {
  const task = await store.createTask(context, randomUUID(), taskInput);
  await pool.query("UPDATE work_items SET status='READY' WHERE id=$1", [task.id]);
  const results = await Promise.allSettled([
    store.claimTask(context, randomUUID(), task.id, { sessionId, expectedVersion: 1 }),
    store.revokeAgentAccess(owner, randomUUID(), principalId, {
      expectedVersion: 1,
      reason: 'Revocación concurrente',
    }),
  ]);
  assert.equal(results[1]!.status, 'fulfilled');
  if (results[0]!.status === 'rejected') assert.equal(results[0]!.reason.code, 'FORBIDDEN');
  assert.equal(
    (
      await pool.query(
        'SELECT active FROM project_members WHERE project_id=$1 AND principal_id=$2',
        [projectId, principalId],
      )
    ).rows[0].active,
    false,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM task_claims WHERE task_id=$1 AND NOT revoked',
        [task.id],
      )
    ).rows[0].count,
    0,
  );
});
