import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, OutboxStore } from '../../packages/db/src/index.ts';
import { FixtureCoordinationStore as CoordinationStore } from '../../apps/api/test/task-requirement-fixture.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { RedisEventSink } from '../../apps/api/src/outbox/redis.ts';
import { OutboxWorker } from '../../apps/api/src/outbox/worker.ts';
import { redisInspector } from '../../apps/api/test/redis-fixtures.ts';
import { ProjectContext } from '../../apps/api/src/projects/context.ts';
import { ProjectQueries } from '../../apps/api/src/projects/queries.ts';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = redisInspector(process.env.REDIS_URL!);
const fixtures: { schema: string; pool: InstanceType<typeof Pool>; projectId: string }[] = [];
before(async () => {
  assert.ok(process.env.DATABASE_URL && process.env.REDIS_URL);
  await redis.connect();
});
after(async () => {
  for (const f of fixtures) {
    await redis.del(`acc:events:${f.projectId}`);
    await f.pool.end();
    await admin.query(`DROP SCHEMA "${f.schema}" CASCADE`);
  }
  if (redis.isOpen) redis.destroy();
  await admin.end();
});
async function fixture() {
  const schema = `acc_test_${randomUUID().replaceAll('-', '')}`,
    projectId = randomUUID(),
    principalId = randomUUID();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 20,
  });
  fixtures.push({ schema, pool, projectId });
  await migrate(pool);
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [projectId, 'Outbox synthetic']);
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [principalId]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
    [projectId, principalId],
  );
  return {
    schema,
    pool,
    projectId,
    principalId,
    store: new CoordinationStore(pool),
    outbox: new OutboxStore(pool),
  };
}
const input = {
  title: 'Evento durable',
  criteria: [{ id: 'a', description: 'Sin pérdida', required: true }],
};
test('100 publicadores adquieren un solo intento y Redis recibe envelope con TTL', async () => {
  const f = await fixture();
  await f.store.createTask(f, randomUUID(), input);
  const attempts = await Promise.all(Array.from({ length: 100 }, () => f.outbox.claimNext()));
  const claims = attempts.filter((attempt) => attempt !== null);
  assert.equal(claims.length, 1);
  const claim = claims[0]!;
  assert.equal(await f.outbox.markPublished({ ...claim, claimToken: randomUUID() }), false);
  const sink = new RedisEventSink(process.env.REDIS_URL!);
  try {
    await sink.publish(claim.event);
    assert.equal(await f.outbox.markPublished(claim), true);
  } finally {
    sink.close();
  }
  const entries = await redis.xRange(`acc:events:${f.projectId}`, '-', '+');
  assert.ok(entries);
  assert.equal(entries.length, 1);
  const event = JSON.parse(entries[0]!.message.event!);
  assert.equal(event.eventId, claim.event.eventId);
  assert.equal(event.seq, '1');
  assert.equal(event.schemaVersion, 1);
  assert.ok((await redis.ttl(`acc:events:${f.projectId}`)) > 0);
  await redis.del(`acc:events:${f.projectId}`);
  const context = new ProjectContext(
    new ProjectQueries(f.pool, 'synthetic'.repeat(8)),
    'synthetic'.repeat(8),
  );
  const recovery = await context.changes(f.projectId, f.principalId, { afterSeq: '0' });
  assert.equal(recovery.events[0]!.eventId, claim.event.eventId);
});
test('interrupción después de publicar y antes de ack se recupera con duplicado identificable', async () => {
  const f = await fixture();
  await f.store.createTask(f, randomUUID(), input);
  const first = (await f.outbox.claimNext())!;
  const sink = new RedisEventSink(process.env.REDIS_URL!);
  try {
    await sink.publish(first.event);
    const restarted = new OutboxStore(f.pool);
    assert.equal(await restarted.claimNext(), null);
    await f.pool.query(
      "UPDATE event_outbox SET locked_until=clock_timestamp()-interval '1 second' WHERE event_id=$1",
      [first.event.eventId],
    );
    const next = (await restarted.claimNext())!;
    assert.equal(next.event.eventId, first.event.eventId);
    assert.ok(next.claimToken !== first.claimToken);
    assert.equal(await f.outbox.markPublished(first), false);
    assert.equal(await f.outbox.markFailed(first), false);
    await sink.publish(next.event);
    assert.equal(await restarted.markPublished(next), true);
    const entries = await redis.xRange(`acc:events:${f.projectId}`, '-', '+');
    assert.ok(entries);
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((entry) => JSON.parse(entry.message.event!).eventId),
      [first.event.eventId, first.event.eventId],
    );
    assert.equal(
      (
        await f.pool.query('SELECT attempts FROM event_outbox WHERE event_id=$1', [
          first.event.eventId,
        ])
      ).rows[0].attempts,
      2,
    );
  } finally {
    sink.close();
  }
});
test('Redis no disponible no revierte la tarea y reintentar entrega el evento pendiente', async () => {
  const f = await fixture();
  const task = await f.store.createTask(f, randomUUID(), input);
  const unavailable = new RedisEventSink('redis://127.0.0.1:1');
  try {
    assert.equal(await new OutboxWorker(f.outbox, unavailable).processOne(), 'failed');
  } finally {
    unavailable.close();
  }
  const pending = (
    await f.pool.query('SELECT published_at,last_error_code,claim_token FROM event_outbox')
  ).rows[0];
  assert.equal(pending.published_at, null);
  assert.equal(pending.claim_token, null);
  assert.equal(pending.last_error_code, 'OUTBOX_DELIVERY_FAILED');
  assert.equal(
    (await f.pool.query('SELECT count(*)::int AS count FROM work_items WHERE id=$1', [task.id]))
      .rows[0].count,
    1,
  );
  await f.pool.query(
    "UPDATE event_outbox SET next_attempt_at=clock_timestamp()-interval '1 second'",
  );
  const restored = new RedisEventSink(process.env.REDIS_URL!);
  try {
    assert.equal(await new OutboxWorker(f.outbox, restored).processOne(), 'published');
  } finally {
    restored.close();
  }
  assert.equal(
    (
      await f.pool.query(
        'SELECT published_at IS NOT NULL AS published,last_error_code FROM event_outbox',
      )
    ).rows[0].published,
    true,
  );
});
test('dos workers entregan eventos distintos y solo confirma el propietario del lease vigente', async () => {
  const f = await fixture();
  await f.store.createTask(f, randomUUID(), input);
  await f.store.createTask(f, randomUUID(), input);
  const a = new RedisEventSink(process.env.REDIS_URL!),
    b = new RedisEventSink(process.env.REDIS_URL!);
  try {
    assert.deepEqual(
      await Promise.all([
        new OutboxWorker(f.outbox, a).processOne(),
        new OutboxWorker(f.outbox, b).processOne(),
      ]),
      ['published', 'published'],
    );
  } finally {
    a.close();
    b.close();
  }
  const entries = await redis.xRange(`acc:events:${f.projectId}`, '-', '+');
  assert.ok(entries);
  assert.deepEqual(entries.map((entry) => JSON.parse(entry.message.event!).seq).sort(), ['1', '2']);
  assert.equal(
    (
      await f.pool.query(
        'SELECT count(*)::int AS count FROM event_outbox WHERE published_at IS NOT NULL',
      )
    ).rows[0].count,
    2,
  );
});
test('limpieza acotada elimina snapshots expirados y conserva los vigentes', async () => {
  const f = await fixture();
  const context = new ProjectContext(
    new ProjectQueries(f.pool, 'synthetic'.repeat(8)),
    'synthetic'.repeat(8),
  );
  const expired = await context.snapshot(f.projectId, f.principalId, {});
  const valid = await context.snapshot(f.projectId, f.principalId, {});
  await f.pool.query(
    "UPDATE context_snapshots SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [expired.snapshotId],
  );
  assert.equal(await f.outbox.cleanupExpiredSnapshots(1), 1);
  assert.equal(
    (
      await f.pool.query(
        'SELECT count(*)::int AS count FROM context_snapshot_pages WHERE snapshot_id=$1',
        [expired.snapshotId],
      )
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await f.pool.query('SELECT count(*)::int AS count FROM context_snapshots WHERE id=$1', [
        valid.snapshotId,
      ])
    ).rows[0].count,
    1,
  );
});
