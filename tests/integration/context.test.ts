import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from '../../packages/db/src/index.ts';
import { FixtureCoordinationStore as CoordinationStore } from '../../apps/api/test/task-requirement-fixture.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { ProjectQueries } from '../../apps/api/src/projects/queries.ts';
import { ProjectContext } from '../../apps/api/src/projects/context.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 20,
});
const secret = 'synthetic-context-cursor-key'.repeat(3);
const store = new CoordinationStore(pool);
const service = () => new ProjectContext(new ProjectQueries(pool, secret), secret);
before(async () => {
  assert.ok(process.env.DATABASE_URL);
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
    principalId = randomUUID();
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [
    projectId,
    'Context synthetic',
  ]);
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [principalId]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
    [projectId, principalId],
  );
  return { projectId, principalId };
}
const input = {
  title: 'Estado inicial',
  criteria: [{ id: 'a', description: 'Verificable', required: true }],
};
test('snapshot materializado no mezcla nuevas escrituras y su cursor sobrevive a otra instancia', async () => {
  const f = await fixture();
  const tasks = await Promise.all(
    Array.from({ length: 3 }, () => store.createTask(f, randomUUID(), input)),
  );
  let page = await service().snapshot(f.projectId, f.principalId, { limit: '1' });
  const snapshotId = page.snapshotId,
    seq = page.projectSeq;
  assert.equal(page.complete, false);
  assert.equal(page.changesCursor, null);
  const later = await store.createTask(f, randomUUID(), { ...input, title: 'Creada después' });
  const records = [...page.records];
  while (page.nextCursor) {
    page = await service().snapshot(f.projectId, f.principalId, { cursor: page.nextCursor });
    assert.equal(page.snapshotId, snapshotId);
    assert.equal(page.projectSeq, seq);
    records.push(...page.records);
  }
  assert.equal(page.complete, true);
  assert.ok(page.changesCursor);
  assert.deepEqual(
    records
      .filter((r) => r.entityType === 'TASK')
      .map((r) => r.data.id)
      .sort(),
    tasks.map((task) => task.id).sort(),
  );
  const changes = await service().changes(f.projectId, f.principalId, {
    cursor: page.changesCursor!,
  });
  assert.deepEqual(
    changes.events.map((event) => event.entity.id),
    [later.id],
  );
  assert.equal(changes.events[0]!.seq, (BigInt(seq) + 1n).toString());
});
test('delta conserva watermark entre páginas mientras se confirman nuevos eventos', async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++) await store.createTask(f, randomUUID(), input);
  let page = await service().changes(f.projectId, f.principalId, { afterSeq: '0', limit: '1' });
  assert.equal(page.throughSeq, '3');
  assert.equal(page.changesCursor, null);
  await store.createTask(f, randomUUID(), input);
  const seqs = page.events.map((event) => event.seq);
  const replayCursor = page.nextCursor!;
  while (page.nextCursor) {
    page = await service().changes(f.projectId, f.principalId, {
      cursor: page.nextCursor,
      limit: '1',
    });
    assert.equal(page.throughSeq, '3');
    seqs.push(...page.events.map((event) => event.seq));
  }
  assert.deepEqual(seqs, ['1', '2', '3']);
  assert.equal(
    (await service().changes(f.projectId, f.principalId, { cursor: replayCursor, limit: '1' }))
      .events[0]!.seq,
    '2',
  );
  const next = await service().changes(f.projectId, f.principalId, { cursor: page.changesCursor! });
  assert.deepEqual(
    next.events.map((event) => event.seq),
    ['4'],
  );
});
test('cursores no autorizan acceso de otro proyecto/principal y snapshot expirado exige recargar', async () => {
  const f = await fixture(),
    other = await fixture();
  await store.createTask(f, randomUUID(), input);
  const first = await service().snapshot(f.projectId, f.principalId, { limit: '1' });
  const cursor = first.nextCursor!;
  await assert.rejects(service().snapshot(other.projectId, other.principalId, { cursor }), {
    code: 'CURSOR_INVALID',
  });
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['VIEWER'])",
    [f.projectId, other.principalId],
  );
  await assert.rejects(service().snapshot(f.projectId, other.principalId, { cursor }), {
    code: 'CURSOR_INVALID',
  });
  await assert.rejects(
    service().snapshot(f.projectId, f.principalId, { cursor: 'A' + cursor.slice(1) }),
    { code: 'CURSOR_INVALID' },
  );
  await pool.query(
    "UPDATE context_snapshots SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [first.snapshotId],
  );
  await assert.rejects(
    service().snapshot(f.projectId, f.principalId, { cursor }),
    (error: unknown) =>
      Boolean(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'CONTEXT_EXPIRED' &&
        'details' in error &&
        (error.details as { snapshotRequired: boolean }).snapshotRequired,
      ),
  );
});
test('revocar membresía impide continuar un snapshot previamente autorizado', async () => {
  const f = await fixture();
  const page = await service().snapshot(f.projectId, f.principalId, { limit: '1' });
  await pool.query(
    'UPDATE project_members SET active=false WHERE project_id=$1 AND principal_id=$2',
    [f.projectId, f.principalId],
  );
  await assert.rejects(
    service().snapshot(f.projectId, f.principalId, { cursor: page.nextCursor! }),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(service().changes(f.projectId, f.principalId, { afterSeq: '0' }), {
    code: 'FORBIDDEN',
  });
});
test('delta maneja BIGINT sin perder precisión y detecta cursores adelantados o huecos', async () => {
  const f = await fixture();
  await store.createTask(f, randomUUID(), input);
  await pool.query(
    "UPDATE project_counters SET value=9007199254740992 WHERE project_id=$1 AND kind='EVENT'",
    [f.projectId],
  );
  await store.createTask(f, randomUUID(), input);
  const page = await service().changes(f.projectId, f.principalId, {
    afterSeq: '9007199254740992',
  });
  assert.equal(page.events[0]!.seq, '9007199254740993');
  await assert.rejects(
    service().changes(f.projectId, f.principalId, { afterSeq: '9007199254740994' }),
    { code: 'CURSOR_AHEAD' },
  );
  await assert.rejects(service().changes(f.projectId, f.principalId, { afterSeq: '1' }), {
    code: 'EVENT_GAP',
  });
});
test('snapshot excluye credenciales y recursos ajenos, y solo entrega fencing al principal propietario', async () => {
  const f = await fixture(),
    other = await fixture();
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['VIEWER'])",
    [f.projectId, other.principalId],
  );
  await store.createTask(other, randomUUID(), { ...input, title: 'foreign-private-marker' });
  await pool.query(
    "INSERT INTO http_sessions(sid,sess,expire) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",
    [randomUUID(), JSON.stringify({ secret: 'http-private-marker' })],
  );
  await pool.query(
    "INSERT INTO oidc_identities(issuer,subject,principal_id,kind) VALUES ($1,$2,$3,'HUMAN')",
    ['https://private.example.test', 'oidc-private-marker', f.principalId],
  );
  const task = await store.createTask(f, randomUUID(), input);
  const ready = await store.transitionTask(f, randomUUID(), task.id, {
    expectedVersion: task.version,
    to: 'READY',
  });
  const session = await store.registerSession(f, randomUUID(), {});
  const lease = await store.claimTask(f, randomUUID(), task.id, {
    expectedVersion: ready.version,
    sessionId: session.id,
  });
  const own = await service().snapshot(f.projectId, f.principalId, { limit: '100' });
  const viewer = await service().snapshot(f.projectId, other.principalId, { limit: '100' });
  assert.equal(
    own.records.find((record) => record.entityType === 'CLAIM')!.data.fencingToken,
    lease.fencingToken,
  );
  assert.equal(
    viewer.records.find((record) => record.entityType === 'CLAIM')!.data.fencingToken,
    null,
  );
  const changes = await service().changes(f.projectId, other.principalId, { afterSeq: '0' });
  assert.equal(
    changes.events.find((event) => event.type === 'claim.acquired')!.payload.fencingToken,
    undefined,
  );
  for (const marker of ['foreign-private-marker', 'http-private-marker', 'oidc-private-marker'])
    assert.equal(JSON.stringify(own).includes(marker), false);
});
