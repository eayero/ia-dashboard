import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from '../../packages/db/src/index.ts';
import { FixtureCoordinationStore as CoordinationStore } from '../../apps/api/test/task-requirement-fixture.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { seedAgentOwner } from '../../apps/api/test/agent-owner-fixture.ts';
import { ProjectQueries } from '../../apps/api/src/projects/queries.ts';
import { RequirementQueries } from '../../apps/api/src/requirements/queries.ts';
import { ProjectContext } from '../../apps/api/src/projects/context.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 20,
});
const store = new CoordinationStore(pool);
before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
async function fixture() {
  const projectId = randomUUID(),
    principalId = randomUUID(),
    agentId = randomUUID();
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [
    projectId,
    'Requirements test',
  ]);
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN'),($2,'AGENT')", [
    principalId,
    agentId,
  ]);
  await seedAgentOwner(pool, agentId, principalId);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles,scopes) VALUES ($1,$2,ARRAY['OWNER'],'{}'),($1,$3,'{}',ARRAY['task:read','task:write'])",
    [projectId, principalId, agentId],
  );
  return { owner: { projectId, principalId }, agent: { projectId, principalId: agentId } };
}
const content = {
  title: 'Acceso seguro',
  description: 'El usuario puede acceder con identidad propia',
  type: 'FUNCTIONAL',
};
const fails = (code: string) => (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === code;
test('requisitos conservan identidad exacta e historial al aprobar sucesoras', async () => {
  assert.equal(typeof store.createRequirement, 'function', 'requirement command must exist');
  const f = await fixture(),
    key = randomUUID();
  const r = await store.createRequirement(f.agent, key, { ...content, externalRef: 'req:access' });
  assert.equal(r.publicId, 'REQ-1');
  assert.deepEqual(
    await store.createRequirement(f.agent, key, { ...content, externalRef: 'req:access' }),
    r,
  );
  assert.equal(
    (
      await store.createRequirement(f.agent, randomUUID(), {
        ...content,
        externalRef: 'req:access',
      })
    ).id,
    r.id,
  );
  await assert.rejects(
    store.approveRequirement(f.agent, randomUUID(), r.id, { expectedVersion: 1, revision: 1 }),
    fails('FORBIDDEN'),
  );
  const approved = await store.approveRequirement(f.owner, randomUUID(), r.id, {
    expectedVersion: 1,
    revision: 1,
  });
  const next = await store.reviseRequirement(f.agent, randomUUID(), r.id, {
    ...content,
    title: 'Acceso actualizado',
    expectedVersion: approved.version,
    reason: 'Cambio requerido',
  });
  await store.approveRequirement(f.owner, randomUUID(), r.id, {
    expectedVersion: next.version,
    revision: next.revision,
  });
  const rows = await pool.query(
    'SELECT revision,status,title FROM requirement_revisions WHERE requirement_id=$1 ORDER BY revision',
    [r.id],
  );
  assert.deepEqual(
    rows.rows.map((x) => x.status),
    ['SUPERSEDED', 'APPROVED'],
  );
  assert.equal(rows.rows[0].title, content.title);
  await assert.rejects(
    pool.query("UPDATE requirement_revisions SET title='mutated' WHERE requirement_id=$1", [r.id]),
  );
});
test('aprobaciones concurrentes solo confirman una revisión y cambios de payload no reutilizan clave', async () => {
  const f = await fixture(),
    key = randomUUID();
  const r = await store.createRequirement(f.owner, key, content);
  await assert.rejects(
    store.createRequirement(f.owner, key, { ...content, title: 'Otro' }),
    fails('IDEMPOTENCY_KEY_REUSED'),
  );
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      store.approveRequirement(f.owner, randomUUID(), r.id, { expectedVersion: 1, revision: 1 }),
    ),
  );
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  const rejected = results.find((x) => x.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && fails('VERSION_CONFLICT')(rejected.reason));
});
test('dos requisitos pendientes mantienen el gate hasta evaluar ambos y no permiten revisión obsoleta', async () => {
  const f = await fixture();
  const task = await store.createTask(f.owner, randomUUID(), {
    title: 'Implementar',
    criteria: [{ id: 'a', description: 'Funciona', required: true }],
  });
  const a = await store.createRequirement(f.owner, randomUUID(), content);
  const b = await store.createRequirement(f.owner, randomUUID(), {
    ...content,
    title: 'Otro requisito',
  });
  const aa = await store.approveRequirement(f.owner, randomUUID(), a.id, {
    expectedVersion: 1,
    revision: 1,
  });
  const bb = await store.approveRequirement(f.owner, randomUUID(), b.id, {
    expectedVersion: 1,
    revision: 1,
  });
  const la = await store.linkRequirement(f.owner, randomUUID(), a.id, {
    expectedVersion: aa.version,
    taskId: task.id,
    taskVersion: task.version,
    operation: 'ADD',
    reason: 'Alcance',
  });
  const lb = await store.linkRequirement(f.owner, randomUUID(), b.id, {
    expectedVersion: bb.version,
    taskId: task.id,
    taskVersion: la.taskVersion,
    operation: 'ADD',
    reason: 'Alcance',
  });
  const ea = await store.evaluateRequirementImpact(f.owner, randomUUID(), a.id, {
    expectedVersion: la.version,
    taskId: task.id,
    taskVersion: lb.taskVersion,
    revision: 1,
    reason: 'Sin cambios adicionales',
  });
  assert.equal(
    (await pool.query('SELECT impact_pending FROM work_items WHERE id=$1', [task.id])).rows[0]
      .impact_pending,
    true,
  );
  const eb = await store.evaluateRequirementImpact(f.owner, randomUUID(), b.id, {
    expectedVersion: lb.version,
    taskId: task.id,
    taskVersion: ea.taskVersion,
    revision: 1,
    reason: 'Verificado',
  });
  assert.equal(
    (await pool.query('SELECT impact_pending FROM work_items WHERE id=$1', [task.id])).rows[0]
      .impact_pending,
    false,
  );
  const draft = await store.reviseRequirement(f.agent, randomUUID(), a.id, {
    ...content,
    expectedVersion: ea.version,
    reason: 'Nueva versión',
  });
  const approved = await store.approveRequirement(f.owner, randomUUID(), a.id, {
    expectedVersion: draft.version,
    revision: draft.revision,
  });
  const current = (
    await pool.query('SELECT version,impact_pending FROM work_items WHERE id=$1', [task.id])
  ).rows[0];
  assert.ok(current.impact_pending);
  assert.ok(eb.taskVersion);
  assert.ok(current.version > eb.taskVersion);
  await assert.rejects(
    store.evaluateRequirementImpact(f.owner, randomUUID(), a.id, {
      expectedVersion: approved.version,
      taskId: task.id,
      taskVersion: current.version,
      revision: 1,
      reason: 'Obsoleta',
    }),
    fails('REQUIREMENT_REVISION_CONFLICT'),
  );
});
test('vínculos ajenos se rechazan y fallo de outbox revierte aprobación e impacto', async () => {
  const f = await fixture(),
    other = await fixture();
  const r = await store.createRequirement(f.owner, randomUUID(), content);
  const task = await store.createTask(other.owner, randomUUID(), {
    title: 'Ajena',
    criteria: [{ id: 'a', description: 'OK', required: true }],
  });
  await assert.rejects(
    store.linkRequirement(f.owner, randomUUID(), r.id, {
      expectedVersion: 1,
      taskId: task.id,
      taskVersion: 1,
      operation: 'ADD',
      reason: 'No permitido',
    }),
    fails('TASK_NOT_FOUND'),
  );
  await pool.query(
    "CREATE FUNCTION fail_requirement_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox unavailable'; END; $$; CREATE TRIGGER fail_requirement_outbox BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION fail_requirement_outbox()",
  );
  try {
    await assert.rejects(
      store.approveRequirement(f.owner, randomUUID(), r.id, { expectedVersion: 1, revision: 1 }),
    );
  } finally {
    await pool.query('DROP TRIGGER fail_requirement_outbox ON event_outbox');
  }
  const row = (
    await pool.query('SELECT version,approved_revision FROM requirements WHERE id=$1', [r.id])
  ).rows[0];
  assert.equal(row.version, 1);
  assert.equal(row.approved_revision, null);
});

test('aprobar cambios conserva DONE y su validación, genera alerta y delta REQUIREMENT', async () => {
  const f = await fixture();
  const task = await store.createTask(f.owner, randomUUID(), {
    title: 'Terminada',
    criteria: [{ id: 'a', description: 'OK', required: true }],
  });
  let version = (
    await store.transitionTask(f.owner, randomUUID(), task.id, { expectedVersion: 1, to: 'READY' })
  ).version;
  const session = await store.registerSession(f.owner, randomUUID(), {});
  const claim = await store.claimTask(f.owner, randomUUID(), task.id, {
    expectedVersion: version,
    sessionId: session.id,
  });
  const lease = { sessionId: session.id, fencingToken: claim.fencingToken };
  version = (
    await store.updateWork(f.owner, randomUUID(), task.id, {
      ...lease,
      expectedVersion: claim.version,
      summary: 'Implementado y verificado',
    })
  ).version;
  version = (
    await store.addEvidence(f.owner, randomUUID(), task.id, {
      ...lease,
      expectedVersion: version,
      kind: 'OTHER',
      url: 'https://example.test/requirement-fixture',
      criterionIds: ['a'],
    })
  ).version;
  for (const to of ['IN_REVIEW', 'IN_QA', 'DONE'])
    version = (
      await store.transitionTask(f.owner, randomUUID(), task.id, {
        ...(to === 'IN_REVIEW' ? lease : {}),
        expectedVersion: version,
        to,
      })
    ).version;
  version = (
    await store.validateTask(f.owner, randomUUID(), task.id, {
      expectedVersion: version,
      workRevision: 2,
      note: 'Validación sintética de fixture',
    })
  ).version;
  const queries = new ProjectQueries(pool, 'test requirement cursor secret');
  const context = new ProjectContext(queries, 'test requirement cursor secret');
  const snapshot = await context.snapshot(f.owner.projectId, f.owner.principalId, { limit: 100 });
  const r = await store.createRequirement(f.agent, randomUUID(), content);
  const linked = await store.linkRequirement(f.owner, randomUUID(), r.id, {
    expectedVersion: r.version,
    taskId: task.id,
    taskVersion: version,
    operation: 'ADD',
    reason: 'Trazar entrega existente',
  });
  await store.approveRequirement(f.owner, randomUUID(), r.id, {
    expectedVersion: linked.version,
    revision: 1,
  });
  const detail = await queries.task(f.owner.projectId, f.owner.principalId, task.id);
  assert.equal(detail.status, 'DONE');
  assert.equal(detail.requirements[0].id, r.id);
  assert.ok(detail.impactPending);
  assert.ok(detail.validations.some((v: { current: boolean }) => v.current));
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS n FROM requirement_impact_alerts WHERE task_id=$1',
        [task.id],
      )
    ).rows[0].n,
    1,
  );
  const delta = await context.changes(f.owner.projectId, f.owner.principalId, {
    cursor: snapshot.changesCursor,
    limit: 100,
  });
  assert.ok(delta.events.some((e) => e.entity.type === 'REQUIREMENT'));
  await store.endSession(f.owner, randomUUID(), session.id, {
    expectedVersion: session.version,
    reason: 'Fixture complete',
  });
});

test('lecturas y cursores aíslan identidades y proyectos; revisión sin aprobar no sustituye la vigente', async () => {
  const f = await fixture(),
    other = await fixture();
  const queries = new RequirementQueries(new ProjectQueries(pool, 'cursor test'), 'cursor test');
  const a = await store.createRequirement(f.owner, randomUUID(), content);
  await store.createRequirement(f.owner, randomUUID(), { ...content, title: 'B' });
  const approved = await store.approveRequirement(f.owner, randomUUID(), a.id, {
    expectedVersion: 1,
    revision: 1,
  });
  await store.reviseRequirement(f.agent, randomUUID(), a.id, {
    ...content,
    title: 'DRAFT',
    expectedVersion: approved.version,
    reason: 'Propuesta',
  });
  const detail = await queries.detail(f.owner.projectId, f.owner.principalId, a.id);
  assert.equal(detail.approvedRevision, 1);
  assert.equal(detail.revisions[0].status, 'APPROVED');
  const page = await queries.list(f.owner.projectId, f.owner.principalId, { limit: 1 });
  assert.ok(page.nextCursor);
  const next = await queries.list(f.owner.projectId, f.owner.principalId, {
    cursor: page.nextCursor,
    limit: 1,
  });
  assert.notEqual(page.items[0]!.id, next.items[0]!.id);
  await assert.rejects(
    queries.list(f.agent.projectId, f.agent.principalId, { cursor: page.nextCursor }),
    fails('CURSOR_INVALID'),
  );
  await assert.rejects(
    queries.detail(other.owner.projectId, other.owner.principalId, a.id),
    fails('REQUIREMENT_NOT_FOUND'),
  );
  await assert.rejects(
    queries.detail(f.owner.projectId, other.owner.principalId, a.id),
    fails('FORBIDDEN'),
  );
  await assert.rejects(
    store.evaluateRequirementImpact(f.agent, randomUUID(), a.id, {
      expectedVersion: 3,
      taskId: randomUUID(),
      taskVersion: 1,
      revision: 1,
      reason: 'No autorizado',
    }),
    fails('FORBIDDEN'),
  );
});

test('impacto pendiente impide review y retirar vínculo conserva historial de evaluación', async () => {
  const f = await fixture();
  const task = await store.createTask(f.owner, randomUUID(), {
    title: 'Gate de impacto',
    criteria: [{ id: 'a', description: 'OK', required: true }],
  });
  const session = await store.registerSession(f.owner, randomUUID(), {});
  const ready = await store.transitionTask(f.owner, randomUUID(), task.id, {
    expectedVersion: 1,
    to: 'READY',
  });
  const claim = await store.claimTask(f.owner, randomUUID(), task.id, {
    expectedVersion: ready.version,
    sessionId: session.id,
  });
  const lease = { sessionId: session.id, fencingToken: claim.fencingToken };
  const work = await store.updateWork(f.owner, randomUUID(), task.id, {
    ...lease,
    expectedVersion: claim.version,
    summary: 'Implementación',
  });
  const evidence = await store.addEvidence(f.owner, randomUUID(), task.id, {
    ...lease,
    expectedVersion: work.version,
    kind: 'OTHER',
    url: 'https://example.test/requirement-gate',
    criterionIds: ['a'],
  });
  const r = await store.createRequirement(f.owner, randomUUID(), content);
  const a = await store.approveRequirement(f.owner, randomUUID(), r.id, {
    expectedVersion: 1,
    revision: 1,
  });
  const link = await store.linkRequirement(f.owner, randomUUID(), r.id, {
    expectedVersion: a.version,
    taskId: task.id,
    taskVersion: evidence.version,
    operation: 'ADD',
    reason: 'Requisito obligatorio',
  });
  await assert.rejects(
    store.transitionTask(f.owner, randomUUID(), task.id, {
      ...lease,
      expectedVersion: link.taskVersion,
      to: 'IN_REVIEW',
    }),
    fails('IMPACT_REVIEW_REQUIRED'),
  );
  const evaluation = await store.evaluateRequirementImpact(f.owner, randomUUID(), r.id, {
    expectedVersion: link.version,
    taskId: task.id,
    taskVersion: link.taskVersion,
    revision: 1,
    reason: 'Contenido implementado',
  });
  const review = await store.transitionTask(f.owner, randomUUID(), task.id, {
    ...lease,
    expectedVersion: evaluation.taskVersion,
    to: 'IN_REVIEW',
  });
  assert.equal(review.status, 'IN_REVIEW');
  const removed = await store.linkRequirement(f.owner, randomUUID(), r.id, {
    expectedVersion: evaluation.version,
    taskId: task.id,
    taskVersion: review.version,
    operation: 'REMOVE',
    reason: 'Retirar alcance explícitamente',
  });
  const queries = new RequirementQueries(new ProjectQueries(pool, 'test'), 'test');
  const detail = await queries.detail(f.owner.projectId, f.owner.principalId, r.id);
  assert.equal(detail.links.length, 0);
  assert.equal(detail.impactReviews.length, 1);
  assert.equal(removed.version, evaluation.version + 1);
  await store.endSession(f.owner, randomUUID(), session.id, {
    expectedVersion: session.version,
    reason: 'Fixture complete',
  });
});
