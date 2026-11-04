import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../packages/db/src/migrate.ts';
import { CoordinationStore, Pool } from '../../packages/db/src/index.ts';
import { seedAgentOwner } from '../../apps/api/test/agent-owner-fixture.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 20,
});
const store = new CoordinationStore(pool);
const criteria = [{ id: 'AC-1', description: 'Resultado comprobable', required: true }];
before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
async function fixture() {
  const projectId = randomUUID();
  const ownerId = randomUUID();
  const agentId = randomUUID();
  const sessionId = randomUUID();
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [
    projectId,
    'Workflow synthetic',
  ]);
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN'),($2,'AGENT')", [
    ownerId,
    agentId,
  ]);
  await seedAgentOwner(pool, agentId, ownerId);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles,scopes) VALUES ($1,$2,ARRAY['OWNER'],'{}'),($1,$3,'{}',ARRAY['task:write'])",
    [projectId, ownerId, agentId],
  );
  await pool.query('INSERT INTO agent_sessions(id,project_id,principal_id) VALUES ($1,$2,$3)', [
    sessionId,
    projectId,
    agentId,
  ]);
  return {
    projectId,
    owner: { projectId, principalId: ownerId },
    agent: { projectId, principalId: agentId },
    sessionId,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function ready(f: Fixture, workType: 'CODE' | 'OTHER' = 'OTHER', taskCriteria = criteria) {
  const task = await store.createTask(f.owner, randomUUID(), {
    title: 'Entrega',
    workType,
    criteria: taskCriteria,
  });
  const planned = await store.transitionTask(f.owner, randomUUID(), task.id, {
    to: 'READY',
    expectedVersion: task.version,
  });
  return { ...planned, id: task.id };
}
async function implementation(
  f: Fixture,
  workType: 'CODE' | 'OTHER' = 'OTHER',
  taskCriteria = criteria,
  dependsOn?: string,
) {
  const task = await ready(f, workType, taskCriteria);
  const planning = dependsOn
    ? await store.changeDependency(f.owner, randomUUID(), task.id, {
        expectedVersion: task.version,
        dependsOn,
        operation: 'ADD',
        reason: 'Base requerida antes de implementar',
      })
    : task;
  const lease = await store.claimTask(f.agent, randomUUID(), task.id, {
    sessionId: f.sessionId,
    expectedVersion: planning.version,
  });
  return { id: task.id, ...lease, sessionId: f.sessionId };
}
async function evidence(
  f: Fixture,
  task: { id: string; version: number; sessionId: string; fencingToken: string },
  overrides: Record<string, unknown> = {},
) {
  const result = await store.addEvidence(f.agent, randomUUID(), task.id, {
    expectedVersion: task.version,
    sessionId: task.sessionId,
    fencingToken: task.fencingToken,
    kind: 'OTHER',
    url: 'https://example.test/report',
    criterionIds: ['AC-1'],
    ...(overrides.kind === 'TEST' ? { result: { outcome: 'PASS', total: 1, passed: 1 } } : {}),
    ...overrides,
  });
  return { ...task, version: result.version, evidenceId: result.id };
}
async function reviewed(f: Fixture, dependsOn?: string) {
  const claimed = await implementation(f, 'OTHER', criteria, dependsOn);
  const declared = await evidence(f, claimed);
  const accepted = await store.acceptEvidence(f.owner, randomUUID(), claimed.id, {
    expectedVersion: declared.version,
    evidenceId: declared.evidenceId,
  });
  const result = await store.transitionTask(f.agent, randomUUID(), claimed.id, {
    to: 'IN_REVIEW',
    expectedVersion: accepted.version,
    sessionId: f.sessionId,
    fencingToken: claimed.fencingToken,
  });
  return { id: claimed.id, ...result };
}
async function qa(f: Fixture, dependsOn?: string) {
  const task = await reviewed(f, dependsOn);
  const approved = await store.approveTask(f.owner, randomUUID(), task.id, {
    expectedVersion: task.version,
    workRevision: task.workRevision,
    kind: 'REVIEW',
  });
  return {
    id: task.id,
    ...(await store.transitionTask(f.owner, randomUUID(), task.id, {
      to: 'IN_QA',
      expectedVersion: approved.version,
    })),
  };
}
async function done(f: Fixture) {
  const task = await qa(f);
  const qaApproval = await store.approveTask(f.owner, randomUUID(), task.id, {
    expectedVersion: task.version,
    workRevision: task.workRevision,
    kind: 'QA',
  });
  const closure = await store.approveTask(f.owner, randomUUID(), task.id, {
    expectedVersion: qaApproval.version,
    workRevision: task.workRevision,
    kind: 'CLOSURE',
  });
  return {
    id: task.id,
    ...(await store.transitionTask(f.owner, randomUUID(), task.id, {
      to: 'DONE',
      expectedVersion: closure.version,
    })),
  };
}

test('agente recorre todos los estados sin aprobaciones y validación humana solo audita DONE', async () => {
  const f = await fixture();
  const created = await store.createTask(f.agent, randomUUID(), { title: 'Autonomía', criteria });
  const ready = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: created.version,
    to: 'READY',
  });
  await assert.rejects(
    store.validateTask(f.owner, randomUUID(), created.id, {
      expectedVersion: ready.version,
      workRevision: 1,
    }),
    { code: 'TASK_NOT_DONE' },
  );
  const claimed = await store.claimTask(f.agent, randomUUID(), created.id, {
    expectedVersion: ready.version,
    sessionId: f.sessionId,
  });
  await assert.rejects(
    store.transitionTask(f.agent, randomUUID(), created.id, {
      expectedVersion: claimed.version,
      sessionId: f.sessionId,
      fencingToken: claimed.fencingToken,
      to: 'IN_REVIEW',
    }),
    { code: 'EVIDENCE_REQUIRED' },
  );
  const declared = await evidence(f, { ...claimed, id: created.id, sessionId: f.sessionId });
  const review = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: declared.version,
    sessionId: f.sessionId,
    fencingToken: claimed.fencingToken,
    to: 'IN_REVIEW',
  });
  const qa = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: review.version,
    to: 'IN_QA',
  });
  const complete = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: qa.version,
    to: 'DONE',
  });
  assert.equal(complete.status, 'DONE');
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM approvals WHERE task_id=$1', [
        created.id,
      ])
    ).rows[0].count,
    0,
  );
  await assert.rejects(
    store.validateTask(f.agent, randomUUID(), created.id, {
      expectedVersion: complete.version,
      workRevision: 1,
    }),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(
    store.validateTask(f.owner, randomUUID(), created.id, {
      expectedVersion: complete.version,
      workRevision: 2,
    }),
    { code: 'WORK_REVISION_CONFLICT' },
  );
  const key = randomUUID();
  const input = { expectedVersion: complete.version, workRevision: 1, note: 'OK humano' };
  const validated = await store.validateTask(f.owner, key, created.id, input);
  assert.deepEqual(
    await store.validateTask(f.owner, key, created.id, input),
    JSON.parse(JSON.stringify(validated)),
  );
  assert.equal(validated.status, 'DONE');
  assert.equal(validated.workRevision, 1);
  assert.equal(validated.version, complete.version + 1);
  await assert.rejects(
    store.validateTask(f.owner, randomUUID(), created.id, {
      ...input,
      expectedVersion: validated.version,
    }),
    { code: 'TASK_ALREADY_VALIDATED' },
  );
  const state = (
    await pool.query('SELECT status,work_revision,completion_version FROM work_items WHERE id=$1', [
      created.id,
    ])
  ).rows[0];
  assert.deepEqual(state, {
    status: 'DONE',
    work_revision: 1,
    completion_version: complete.version,
  });
  const reopened = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: validated.version,
    to: 'READY',
    reason: 'Continuar',
  });
  assert.equal(reopened.status, 'READY');
  assert.equal(
    (await pool.query('SELECT completion_version FROM work_items WHERE id=$1', [created.id]))
      .rows[0].completion_version,
    null,
  );
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM task_validations WHERE task_id=$1', [
        created.id,
      ])
    ).rows[0].count,
    1,
  );
  await assert.rejects(pool.query('DELETE FROM task_validations WHERE task_id=$1', [created.id]));
  const nextClaim = await store.claimTask(f.agent, randomUUID(), created.id, {
    expectedVersion: reopened.version,
    sessionId: f.sessionId,
  });
  const nextReview = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: nextClaim.version,
    sessionId: f.sessionId,
    fencingToken: nextClaim.fencingToken,
    to: 'IN_REVIEW',
  });
  const nextQa = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: nextReview.version,
    to: 'IN_QA',
  });
  const nextDone = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: nextQa.version,
    to: 'DONE',
  });
  const historical = await pool.query(
    'SELECT v.completion_version=w.completion_version AS current FROM task_validations v JOIN work_items w ON w.id=v.task_id WHERE v.task_id=$1',
    [created.id],
  );
  assert.equal(historical.rows[0].current, false);
  const secondValidation = await store.validateTask(f.owner, randomUUID(), created.id, {
    expectedVersion: nextDone.version,
    workRevision: 1,
  });
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM task_validations WHERE task_id=$1', [
        created.id,
      ])
    ).rows[0].count,
    2,
  );
  const reopenedAgain = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: secondValidation.version,
    to: 'READY',
    reason: 'Cancelar trabajo futuro',
  });
  const cancelled = await store.transitionTask(f.agent, randomUUID(), created.id, {
    expectedVersion: reopenedAgain.version,
    to: 'CANCELLED',
    reason: 'Ya no procede',
  });
  assert.equal(cancelled.status, 'CANCELLED');
  const counts = (
    await pool.query(
      'SELECT (SELECT count(*)::int FROM audit_events WHERE entity_id=$1) AS events,(SELECT count(*)::int FROM event_outbox o JOIN audit_events e ON o.event_id=e.id WHERE e.entity_id=$1) AS outbox',
      [created.id],
    )
  ).rows[0];
  assert.equal(counts.events, counts.outbox);
});
test('validación humana concurrente resuelve una vez y falla si no puede auditarse', async () => {
  const f = await fixture();
  const task = await done(f);
  await pool.query(
    "CREATE FUNCTION reject_validation_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='task.validated' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_validation_fixture BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_validation_fixture()",
  );
  try {
    await assert.rejects(
      store.validateTask(f.owner, randomUUID(), task.id, {
        expectedVersion: task.version,
        workRevision: task.workRevision,
      }),
    );
  } finally {
    await pool.query(
      'DROP TRIGGER reject_validation_fixture ON audit_events; DROP FUNCTION reject_validation_fixture()',
    );
  }
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM task_validations WHERE task_id=$1', [
        task.id,
      ])
    ).rows[0].count,
    0,
  );
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      store.validateTask(f.owner, randomUUID(), task.id, {
        expectedVersion: task.version,
        workRevision: task.workRevision,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter((r) => r.status === 'rejected' && r.reason.code === 'VERSION_CONFLICT').length,
    1,
  );
});
test('cambio protegido rechaza claim expirado y cambio humano explícito revoca y conserva historia', async () => {
  const f = await fixture();
  const task = await implementation(f);
  await pool.query(
    "UPDATE task_claims SET expires_at=clock_timestamp()-interval '1 second' WHERE task_id=$1",
    [task.id],
  );
  await assert.rejects(
    store.updateWork(f.agent, randomUUID(), task.id, {
      expectedVersion: task.version,
      sessionId: f.sessionId,
      fencingToken: task.fencingToken,
      summary: 'Avance tardío',
    }),
    { code: 'STALE_CLAIM' },
  );
  const reclaimed = await store.claimTask(f.agent, randomUUID(), task.id, {
    expectedVersion: task.version,
    sessionId: f.sessionId,
  });
  const revised = await store.reviseTask(f.owner, randomUUID(), task.id, {
    expectedVersion: reclaimed.version,
    title: 'Nuevo alcance',
    criteria,
    reason: 'Cambió el requisito',
  });
  assert.equal(revised.status, 'BACKLOG');
  assert.equal(revised.workRevision, 2);
  await assert.rejects(
    store.updateWork(f.agent, randomUUID(), task.id, {
      expectedVersion: revised.version,
      sessionId: f.sessionId,
      fencingToken: reclaimed.fencingToken,
      summary: 'Propiedad perdida',
    }),
    { code: 'STALE_CLAIM' },
  );
  const event = (
    await pool.query(
      "SELECT payload FROM audit_events WHERE entity_id=$1 AND action='task.revised'",
      [task.id],
    )
  ).rows[0].payload;
  assert.equal(event.before.title, 'Entrega');
  assert.equal(event.after.title, 'Nuevo alcance');
});
test('aprobaciones concurrentes resuelven una sola vez y rechazo invalida aprobaciones', async () => {
  const f = await fixture();
  const task = await reviewed(f);
  const results = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      store.approveTask(f.owner, randomUUID(), task.id, {
        expectedVersion: task.version,
        workRevision: task.workRevision,
        kind: 'REVIEW',
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter((r) => r.status === 'rejected' && r.reason.code === 'VERSION_CONFLICT').length,
    1,
  );
  const winner = results.find((r) => r.status === 'fulfilled');
  assert.ok(winner && winner.status === 'fulfilled');
  const reject = await store.transitionTask(f.owner, randomUUID(), task.id, {
    expectedVersion: winner.value.version,
    to: 'IN_PROGRESS',
    reason: 'Corregir resultado',
  });
  assert.equal(reject.status, 'IN_PROGRESS');
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM approvals WHERE task_id=$1 AND invalidated_at IS NULL',
        [task.id],
      )
    ).rows[0].count,
    0,
  );
  const lease = await store.claimTask(f.agent, randomUUID(), task.id, {
    expectedVersion: reject.version,
    sessionId: f.sessionId,
  });
  const changed = await store.updateWork(f.agent, randomUUID(), task.id, {
    expectedVersion: lease.version,
    sessionId: f.sessionId,
    fencingToken: lease.fencingToken,
    summary: 'Corrección sustancial',
  });
  assert.equal(changed.workRevision, task.workRevision + 1);
  await assert.rejects(
    store.transitionTask(f.agent, randomUUID(), task.id, {
      expectedVersion: changed.version,
      sessionId: f.sessionId,
      fencingToken: lease.fencingToken,
      to: 'IN_REVIEW',
    }),
    { code: 'EVIDENCE_REQUIRED' },
  );
});

test('dependencias opuestas concurrentes nunca forman ciclo y referencias cross-project se rechazan', async () => {
  const f = await fixture();
  const a = await ready(f);
  const b = await ready(f);
  const results = await Promise.allSettled([
    store.changeDependency(f.owner, randomUUID(), a.id, {
      expectedVersion: a.version,
      dependsOn: b.id,
      operation: 'ADD',
      reason: 'Orden A',
    }),
    store.changeDependency(f.owner, randomUUID(), b.id, {
      expectedVersion: b.version,
      dependsOn: a.id,
      operation: 'ADD',
      reason: 'Orden B',
    }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter((r) => r.status === 'rejected' && r.reason.code === 'DEPENDENCY_CYCLE').length,
    1,
  );
  const other = await fixture();
  const foreign = await ready(other);
  const current = (await pool.query('SELECT version FROM work_items WHERE id=$1', [a.id])).rows[0];
  await assert.rejects(
    store.changeDependency(f.owner, randomUUID(), a.id, {
      expectedVersion: current.version,
      dependsOn: foreign.id,
      operation: 'ADD',
      reason: 'Cruce prohibido',
    }),
    { code: 'TASK_NOT_FOUND' },
  );
  await assert.rejects(
    pool.query('INSERT INTO task_dependencies(project_id,task_id,depends_on) VALUES ($1,$2,$3)', [
      f.projectId,
      a.id,
      foreign.id,
    ]),
    { code: '23503' },
  );
});

test('nuevo bloqueo duro revoca claim y completar dependencia devuelve READY', async () => {
  const f = await fixture();
  const prerequisite = await qa(f);
  const task = await implementation(f);
  const blocked = await store.changeDependency(f.owner, randomUUID(), task.id, {
    expectedVersion: task.version,
    dependsOn: prerequisite.id,
    operation: 'ADD',
    reason: 'Necesita la base',
  });
  assert.equal(blocked.status, 'BLOCKED');
  await assert.rejects(
    store.updateWork(f.agent, randomUUID(), task.id, {
      expectedVersion: blocked.version,
      sessionId: f.sessionId,
      fencingToken: task.fencingToken,
      summary: 'Trabajo tras bloqueo',
    }),
    { code: 'STALE_CLAIM' },
  );
  await assert.rejects(
    store.claimTask(f.agent, randomUUID(), task.id, {
      expectedVersion: blocked.version,
      sessionId: f.sessionId,
    }),
    { code: 'DEPENDENCIES_UNMET' },
  );
  const qaApproval = await store.approveTask(f.owner, randomUUID(), prerequisite.id, {
    expectedVersion: prerequisite.version,
    workRevision: prerequisite.workRevision,
    kind: 'QA',
  });
  const closure = await store.approveTask(f.owner, randomUUID(), prerequisite.id, {
    expectedVersion: qaApproval.version,
    workRevision: prerequisite.workRevision,
    kind: 'CLOSURE',
  });
  await store.transitionTask(f.owner, randomUUID(), prerequisite.id, {
    expectedVersion: closure.version,
    to: 'DONE',
  });
  const resumed = (await pool.query('SELECT status,version FROM work_items WHERE id=$1', [task.id]))
    .rows[0];
  assert.equal(resumed.status, 'READY');
  const next = await store.claimTask(f.agent, randomUUID(), task.id, {
    expectedVersion: resumed.version,
    sessionId: f.sessionId,
  });
  assert.ok(BigInt(next.fencingToken) > BigInt(task.fencingToken));
});

test('claim concurrente con reapertura termina bloqueado y sin propiedad vigente', async () => {
  const f = await fixture();
  const prerequisite = await done(f);
  const task = await ready(f);
  const linked = await store.changeDependency(f.owner, randomUUID(), task.id, {
    expectedVersion: task.version,
    dependsOn: prerequisite.id,
    operation: 'ADD',
    reason: 'Dependencia satisfecha',
  });
  const results = await Promise.allSettled([
    store.claimTask(f.agent, randomUUID(), task.id, {
      expectedVersion: linked.version,
      sessionId: f.sessionId,
    }),
    store.transitionTask(f.owner, randomUUID(), prerequisite.id, {
      expectedVersion: prerequisite.version,
      to: 'READY',
      reason: 'Regresión detectada',
    }),
  ]);
  assert.equal(results[1]!.status, 'fulfilled');
  const final = (await pool.query('SELECT status FROM work_items WHERE id=$1', [task.id])).rows[0];
  assert.equal(final.status, 'BLOCKED');
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM task_claims WHERE task_id=$1 AND NOT revoked AND expires_at>clock_timestamp()',
        [task.id],
      )
    ).rows[0].count,
    0,
  );
});

test('reabrir dependencia de DONE conserva cierre y registra alerta persistente', async () => {
  const f = await fixture();
  const prerequisite = await done(f);
  const task = await qa(f, prerequisite.id);
  const qaApproval = await store.approveTask(f.owner, randomUUID(), task.id, {
    expectedVersion: task.version,
    workRevision: task.workRevision,
    kind: 'QA',
  });
  const closure = await store.approveTask(f.owner, randomUUID(), task.id, {
    expectedVersion: qaApproval.version,
    workRevision: task.workRevision,
    kind: 'CLOSURE',
  });
  await store.transitionTask(f.owner, randomUUID(), task.id, {
    expectedVersion: closure.version,
    to: 'DONE',
  });
  await store.transitionTask(f.owner, randomUUID(), prerequisite.id, {
    expectedVersion: prerequisite.version,
    to: 'READY',
    reason: 'Nueva incidencia',
  });
  assert.equal(
    (await pool.query('SELECT status FROM work_items WHERE id=$1', [task.id])).rows[0].status,
    'DONE',
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM task_alerts WHERE task_id=$1 AND depends_on=$2',
        [task.id, prerequisite.id],
      )
    ).rows[0].count,
    1,
  );
});

test('retirar dependencia no resuelve un bloqueo manual independiente', async () => {
  const f = await fixture();
  const task = await implementation(f);
  const manual = await store.transitionTask(f.agent, randomUUID(), task.id, {
    expectedVersion: task.version,
    to: 'BLOCKED',
    reason: 'Esperando acceso',
    sessionId: f.sessionId,
    fencingToken: task.fencingToken,
  });
  const prerequisite = await ready(f);
  const linked = await store.changeDependency(f.owner, randomUUID(), task.id, {
    expectedVersion: manual.version,
    dependsOn: prerequisite.id,
    operation: 'ADD',
    reason: 'También espera base',
  });
  const removed = await store.changeDependency(f.owner, randomUUID(), task.id, {
    expectedVersion: linked.version,
    dependsOn: prerequisite.id,
    operation: 'REMOVE',
    reason: 'Ya no se requiere',
  });
  assert.equal(removed.status, 'BLOCKED');
  const explicit = await store.transitionTask(f.owner, randomUUID(), task.id, {
    expectedVersion: removed.version,
    to: 'READY',
  });
  assert.equal(explicit.status, 'READY');
});

test('tarea de código requiere pruebas del mismo repositorio y commit aceptados', async () => {
  const f = await fixture();
  const repositoryId = randomUUID();
  await pool.query('INSERT INTO repositories(id,project_id,name,url) VALUES ($1,$2,$3,$4)', [
    repositoryId,
    f.projectId,
    'Synthetic repository',
    'https://example.test/repo',
  ]);
  const task = await implementation(f, 'CODE');
  const code = await evidence(f, task, { kind: 'CODE', repositoryId, commit: 'a'.repeat(40) });
  const acceptedCode = await store.acceptEvidence(f.owner, randomUUID(), task.id, {
    expectedVersion: code.version,
    evidenceId: code.evidenceId,
  });
  const wrong = await evidence(
    f,
    { ...task, version: acceptedCode.version },
    { kind: 'TEST', repositoryId, commit: 'b'.repeat(40) },
  );
  const acceptedWrong = await store.acceptEvidence(f.owner, randomUUID(), task.id, {
    expectedVersion: wrong.version,
    evidenceId: wrong.evidenceId,
  });
  const send = (version: number) =>
    store.transitionTask(f.agent, randomUUID(), task.id, {
      expectedVersion: version,
      to: 'IN_REVIEW',
      sessionId: f.sessionId,
      fencingToken: task.fencingToken,
    });
  await assert.rejects(send(acceptedWrong.version), { code: 'EVIDENCE_REQUIRED' });
  const matching = await evidence(
    f,
    { ...task, version: acceptedWrong.version },
    { kind: 'TEST', repositoryId, commit: 'a'.repeat(40) },
  );
  const accepted = await store.acceptEvidence(f.owner, randomUUID(), task.id, {
    expectedVersion: matching.version,
    evidenceId: matching.evidenceId,
  });
  assert.equal((await send(accepted.version)).status, 'IN_REVIEW');
});

test('aceptación de otro criterio o tarea no satisface todos los criterios obligatorios', async () => {
  const f = await fixture();
  const task = await implementation(f, 'OTHER', [
    ...criteria,
    { id: 'AC-2', description: 'Segundo requisito', required: true },
  ]);
  const declared = await evidence(f, task);
  const accepted = await store.acceptEvidence(f.owner, randomUUID(), task.id, {
    expectedVersion: declared.version,
    evidenceId: declared.evidenceId,
  });
  await assert.rejects(
    store.transitionTask(f.agent, randomUUID(), task.id, {
      expectedVersion: accepted.version,
      to: 'IN_REVIEW',
      sessionId: f.sessionId,
      fencingToken: task.fencingToken,
    }),
    { code: 'CRITERIA_UNMET' },
  );
  const other = await implementation(f);
  await assert.rejects(
    store.acceptEvidence(f.owner, randomUUID(), other.id, {
      expectedVersion: other.version,
      evidenceId: declared.evidenceId,
    }),
    { code: 'EVIDENCE_NOT_ACCEPTABLE' },
  );
  await assert.rejects(evidence(f, other, { criterionIds: ['UNKNOWN'] }), {
    code: 'CRITERION_NOT_FOUND',
  });
  await assert.rejects(
    evidence(f, other, { kind: 'CODE', repositoryId: randomUUID(), commit: 'a'.repeat(40) }),
    { code: 'REPOSITORY_NOT_FOUND' },
  );
});

test('cierre concurrente con reapertura de prerrequisito bloquea o deja alerta, sin perder el cambio', async () => {
  const f = await fixture();
  const prerequisite = await done(f);
  const task = await qa(f, prerequisite.id);
  const qaApproval = await store.approveTask(f.owner, randomUUID(), task.id, {
    expectedVersion: task.version,
    workRevision: task.workRevision,
    kind: 'QA',
  });
  const closure = await store.approveTask(f.owner, randomUUID(), task.id, {
    expectedVersion: qaApproval.version,
    workRevision: task.workRevision,
    kind: 'CLOSURE',
  });
  const results = await Promise.allSettled([
    store.transitionTask(f.owner, randomUUID(), task.id, {
      expectedVersion: closure.version,
      to: 'DONE',
    }),
    store.transitionTask(f.owner, randomUUID(), prerequisite.id, {
      expectedVersion: prerequisite.version,
      to: 'READY',
      reason: 'Revisar regresión',
    }),
  ]);
  assert.equal(results[1]!.status, 'fulfilled');
  const final = (await pool.query('SELECT status FROM work_items WHERE id=$1', [task.id])).rows[0];
  if (results[0]!.status === 'fulfilled') {
    assert.equal(final.status, 'DONE');
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS count FROM task_alerts WHERE task_id=$1', [
          task.id,
        ])
      ).rows[0].count,
      1,
    );
  } else {
    assert.equal(results[0]!.reason.code, 'VERSION_CONFLICT');
    assert.equal(final.status, 'BLOCKED');
  }
});

test('agentes no pueden figurar como aprobadores ni aceptadores incluso por FK', async () => {
  const f = await fixture();
  const task = await implementation(f);
  const declared = await evidence(f, task);
  await assert.rejects(
    pool.query(
      'INSERT INTO approvals(id,project_id,task_id,work_revision,kind,principal_id,approved_roles) VALUES ($1,$2,$3,1,$4,$5,$6)',
      [randomUUID(), f.projectId, task.id, 'REVIEW', f.agent.principalId, ['OWNER']],
    ),
    { code: '23503' },
  );
  await assert.rejects(
    pool.query('UPDATE evidence SET accepted_by=$1,accepted_at=clock_timestamp() WHERE id=$2', [
      f.agent.principalId,
      declared.evidenceId,
    ]),
    { code: '23503' },
  );
});

test('pruebas fallidas aceptadas conservan evidencia pero no habilitan review de código', async () => {
  const f = await fixture();
  const repositoryId = randomUUID();
  await pool.query('INSERT INTO repositories(id,project_id,name,url) VALUES ($1,$2,$3,$4)', [
    repositoryId,
    f.projectId,
    'Synthetic',
    'https://example.test/repo',
  ]);
  const task = await implementation(f, 'CODE');
  const code = await evidence(f, task, { kind: 'CODE', repositoryId, commit: 'a'.repeat(40) });
  const acceptedCode = await store.acceptEvidence(f.owner, randomUUID(), task.id, {
    expectedVersion: code.version,
    evidenceId: code.evidenceId,
  });
  const failed = await evidence(
    f,
    { ...task, version: acceptedCode.version },
    {
      kind: 'TEST',
      repositoryId,
      commit: 'a'.repeat(40),
      result: { outcome: 'FAIL', total: 4, passed: 3 },
    },
  );
  const acceptedFailed = await store.acceptEvidence(f.owner, randomUUID(), task.id, {
    expectedVersion: failed.version,
    evidenceId: failed.evidenceId,
  });
  await assert.rejects(
    store.transitionTask(f.agent, randomUUID(), task.id, {
      expectedVersion: acceptedFailed.version,
      to: 'IN_REVIEW',
      sessionId: f.sessionId,
      fencingToken: task.fencingToken,
    }),
    { code: 'EVIDENCE_REQUIRED' },
  );
});

test('nuevo bloqueo de tarea BACKLOG queda visible como BLOCKED', async () => {
  const f = await fixture();
  const prerequisite = await ready(f);
  const task = await store.createTask(f.owner, randomUUID(), {
    title: 'Bloqueo antes de planificar',
    criteria,
  });
  const linked = await store.changeDependency(f.owner, randomUUID(), task.id, {
    expectedVersion: task.version,
    dependsOn: prerequisite.id,
    operation: 'ADD',
    reason: 'Esperar la base',
  });
  assert.equal(linked.status, 'BLOCKED');
});

test('cambio humano de dependencias satisfechas revoca claim y exige nueva planificación', async () => {
  const f = await fixture();
  const prerequisite = await done(f);
  const task = await implementation(f);
  const changed = await store.changeDependency(f.owner, randomUUID(), task.id, {
    expectedVersion: task.version,
    dependsOn: prerequisite.id,
    operation: 'ADD',
    reason: 'Cambio de alcance explícito',
  });
  assert.equal(changed.status, 'READY');
  await assert.rejects(
    store.updateWork(f.agent, randomUUID(), task.id, {
      expectedVersion: changed.version,
      sessionId: f.sessionId,
      fencingToken: task.fencingToken,
      summary: 'Avance con alcance antiguo',
    }),
    { code: 'STALE_CLAIM' },
  );
});

test('un informe TEST fallido tampoco satisface criterios de una tarea no técnica', async () => {
  const f = await fixture();
  const repositoryId = randomUUID();
  await pool.query('INSERT INTO repositories(id,project_id,name,url) VALUES ($1,$2,$3,$4)', [
    repositoryId,
    f.projectId,
    'Synthetic',
    'https://example.test/repo',
  ]);
  const task = await implementation(f);
  const failed = await evidence(f, task, {
    kind: 'TEST',
    repositoryId,
    commit: 'a'.repeat(40),
    result: { outcome: 'FAIL', total: 2, passed: 1 },
  });
  const accepted = await store.acceptEvidence(f.owner, randomUUID(), task.id, {
    expectedVersion: failed.version,
    evidenceId: failed.evidenceId,
  });
  await assert.rejects(
    store.transitionTask(f.agent, randomUUID(), task.id, {
      expectedVersion: accepted.version,
      to: 'IN_REVIEW',
      sessionId: f.sessionId,
      fencingToken: task.fencingToken,
    }),
    { code: 'EVIDENCE_REQUIRED' },
  );
});
