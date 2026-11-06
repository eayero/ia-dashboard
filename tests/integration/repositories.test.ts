import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, CoordinationStore } from '../../packages/db/src/index.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { bootstrapLocal } from '../../apps/api/src/local-bootstrap.ts';
import { createApplication } from '../../apps/api/src/app.ts';
import { loadConfiguration } from '../../apps/api/src/config.ts';
import { Client, StreamableHTTPClientTransport } from '../../apps/api/test/mcp-client.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const store = new CoordinationStore(pool);
const config = loadConfiguration(process.env);
let app: Awaited<ReturnType<typeof createApplication>>, base: string;
let seeded: Awaited<ReturnType<typeof bootstrapLocal>>;
let cookie: string, csrf: string;

before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
  seeded = await bootstrapLocal(process.env, pool);
  app = await createApplication(config, pool);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  let r = await fetch(base + '/api/v1/auth/session');
  csrf = (await r.json()).data.csrfToken;
  cookie = r.headers
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
    body: JSON.stringify({ username: seeded.username, password: seeded.password }),
  });
  assert.equal(r.status, 201);
  cookie = r.headers
    .getSetCookie()
    .find((c) => c.startsWith('acc.sid='))!
    .split(';')[0]!;
  r = await fetch(base + '/api/v1/auth/session', { headers: { cookie } });
  csrf = (await r.json()).data.csrfToken;
});
after(async () => {
  if (app) await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
const context = () => ({ projectId: seeded.projectId, principalId: seeded.principalId });
const metadata = (suffix: string) => ({
  name: 'dashboard',
  url: `https://github.com/acc/${suffix}`,
});
async function post(
  input: unknown,
  key: string = randomUUID(),
  extra: Record<string, string> = {},
) {
  return fetch(`${base}/api/v1/projects/${seeded.projectId}/repositories`, {
    method: 'POST',
    headers: {
      cookie,
      origin: config.publicOrigin,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
      'idempotency-key': key,
      ...extra,
    },
    body: JSON.stringify(input),
  });
}
async function get(path: string, headers: Record<string, string> = { cookie }) {
  return fetch(`${base}/api/v1/projects/${seeded.projectId}${path}`, { headers });
}

test('repository writes are idempotent and concurrent exact URLs share one audit event', async () => {
  assert.equal(typeof store.registerRepository, 'function');
  const key = randomUUID(),
    input = metadata('concurrent');
  const writes = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      store.registerRepository(context(), i === 0 ? key : randomUUID(), input),
    ),
  );
  assert.equal(new Set(writes.map((r) => r.id)).size, 1);
  const repo = writes[0]!;
  assert.deepEqual(await store.registerRepository(context(), key, input), repo);
  const found = await pool.query('SELECT * FROM audit_events WHERE entity_id=$1', [repo.id]);
  assert.equal(found.rowCount, 1);
  assert.equal(found.rows[0].entity_type, 'REPOSITORY');
  assert.equal(found.rows[0].action, 'repository.registered');
  assert.equal(
    (await pool.query('SELECT 1 FROM event_outbox WHERE event_id=$1', [found.rows[0].id])).rowCount,
    1,
  );
  await assert.rejects(store.registerRepository(context(), key, metadata('different')), {
    code: 'IDEMPOTENCY_KEY_REUSED',
  });
  const exact = await store.registerRepository(context(), randomUUID(), {
    name: 'another name',
    url: input.url,
  });
  assert.equal(exact.id, repo.id);
  assert.equal(exact.name, 'dashboard');
});

test('repository management rejects agents, viewers, reviewers, revoked and foreign access', async () => {
  for (const role of ['VIEWER', 'REVIEWER']) {
    const principalId = randomUUID();
    await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [principalId]);
    await pool.query(
      'INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,$3)',
      [seeded.projectId, principalId, [role]],
    );
    await assert.rejects(
      store.registerRepository(
        { projectId: seeded.projectId, principalId },
        randomUUID(),
        metadata(role),
      ),
      { code: 'FORBIDDEN' },
    );
  }
  await assert.rejects(
    store.registerRepository(
      { projectId: seeded.projectId, principalId: seeded.agents[0]!.principalId },
      randomUUID(),
      metadata('agent'),
    ),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(
    store.registerRepository(
      { projectId: randomUUID(), principalId: seeded.principalId },
      randomUUID(),
      metadata('foreign'),
    ),
    { code: 'FORBIDDEN' },
  );
  const key = randomUUID(),
    input = metadata('revoked');
  await store.registerRepository(context(), key, input);
  await pool.query(
    'UPDATE project_members SET active=false WHERE project_id=$1 AND principal_id=$2',
    [seeded.projectId, seeded.principalId],
  );
  try {
    await assert.rejects(store.registerRepository(context(), key, input), { code: 'FORBIDDEN' });
  } finally {
    await pool.query(
      'UPDATE project_members SET active=true WHERE project_id=$1 AND principal_id=$2',
      [seeded.projectId, seeded.principalId],
    );
  }
});

test('repository writes reject archived projects and roll back entity/event on failure', async () => {
  await pool.query('UPDATE projects SET archived=true WHERE id=$1', [seeded.projectId]);
  try {
    await assert.rejects(store.registerRepository(context(), randomUUID(), metadata('archived')), {
      code: 'PROJECT_ARCHIVED',
    });
  } finally {
    await pool.query('UPDATE projects SET archived=false WHERE id=$1', [seeded.projectId]);
  }
  await pool.query(
    `CREATE FUNCTION fail_repository_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM audit_events WHERE id=NEW.event_id AND action='repository.registered') THEN RAISE EXCEPTION 'Synthetic outbox failure'; END IF; RETURN NEW; END; $$`,
  );
  await pool.query(
    'CREATE TRIGGER fail_repository_outbox BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION fail_repository_outbox()',
  );
  const input = metadata('rollback');
  try {
    await assert.rejects(
      store.registerRepository(context(), randomUUID(), input),
      /Synthetic outbox failure/,
    );
  } finally {
    await pool.query('DROP TRIGGER fail_repository_outbox ON event_outbox');
  }
  assert.equal(
    (await pool.query('SELECT 1 FROM repositories WHERE url=$1', [input.url])).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM audit_events WHERE action='repository.registered' AND payload->>'url'=$1",
        [input.url],
      )
    ).rowCount,
    0,
  );
});

test('a former manager cannot replay a registration after being downgraded to reviewer', async () => {
  const principalId = randomUUID();
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [principalId]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['MANAGER'])",
    [seeded.projectId, principalId],
  );
  const actor = { projectId: seeded.projectId, principalId },
    key = randomUUID(),
    input = metadata('downgrade');
  await store.registerRepository(actor, key, input);
  await pool.query(
    "UPDATE project_members SET roles=ARRAY['REVIEWER'] WHERE project_id=$1 AND principal_id=$2",
    [seeded.projectId, principalId],
  );
  await assert.rejects(store.registerRepository(actor, key, input), { code: 'FORBIDDEN' });
});

test('REST repository registration validates payload, idempotency and cookie CSRF', async () => {
  const input = metadata('rest'),
    key = randomUUID();
  let r = await post(input, key);
  assert.equal(r.status, 201);
  const repo = (await r.json()).data;
  r = await post(input, key);
  assert.equal(r.status, 201);
  assert.deepEqual((await r.json()).data, repo);
  assert.equal(
    (await post(metadata('csrf'), randomUUID(), { 'x-csrf-token': 'invalid' })).status,
    403,
  );
  assert.equal((await post(metadata('no-key'), '')).status, 400);
  assert.equal((await post({ ...input, url: 'https://user:secret@github.com/repo' })).status, 400);
  r = await get('/repositories');
  assert.equal(r.status, 200);
  assert.ok((await r.json()).data.items.some((item: { id: string }) => item.id === repo.id));
  r = await fetch(`${base}/api/v1/projects/${seeded.projectId}/repositories`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${seeded.agents[0]!.apiToken}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify(metadata('bearer')),
  });
  assert.equal(r.status, 403);
});

test('repository pages isolate resource/project/principal cursors and remain readable by agents', async () => {
  const bearer = { authorization: `Bearer ${seeded.agents[0]!.apiToken}` };
  const all = (await (await get('/repositories?limit=100', bearer)).json()).data;
  assert.ok(all.items.length >= 2);
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const r = await get(
      '/repositories?limit=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      bearer,
    );
    assert.equal(r.status, 200);
    const page = (await r.json()).data;
    ids.push(...page.items.map((item: { id: string }) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(
    ids,
    all.items.map((item: { id: string }) => item.id),
  );
  const first = (await (await get('/repositories?limit=1', bearer)).json()).data;
  assert.equal(
    (await get('/repositories?cursor=' + encodeURIComponent(first.nextCursor))).status,
    400,
  );
  assert.equal(
    (await get('/repositories?cursor=' + encodeURIComponent(first.nextCursor + 'tampered'), bearer))
      .status,
    400,
  );
  assert.equal(
    (await get('/tasks?cursor=' + encodeURIComponent(first.nextCursor), bearer)).status,
    400,
  );
  const other = randomUUID();
  await pool.query("INSERT INTO projects(id,name) VALUES ($1,'Other')", [other]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
    [other, seeded.principalId],
  );
  const humanFirst = (await (await get('/repositories?limit=1')).json()).data;
  assert.equal(
    (
      await fetch(
        `${base}/api/v1/projects/${other}/repositories?cursor=${encodeURIComponent(humanFirst.nextCursor)}`,
        { headers: { cookie } },
      )
    ).status,
    400,
  );
  const hidden = await fetch(`${base}/api/v1/projects/${randomUUID()}/repositories`, {
    headers: { cookie },
  });
  assert.equal(hidden.status, 403);
});

test('REST enforces project management roles while viewers retain read access', async () => {
  for (const role of ['VIEWER', 'REVIEWER']) {
    await pool.query(
      'UPDATE project_members SET roles=$3 WHERE project_id=$1 AND principal_id=$2',
      [seeded.projectId, seeded.principalId, [role]],
    );
    try {
      assert.equal((await post(metadata('role-' + role))).status, 403);
      assert.equal((await get('/repositories')).status, 200);
    } finally {
      await pool.query(
        "UPDATE project_members SET roles=ARRAY['OWNER'] WHERE project_id=$1 AND principal_id=$2",
        [seeded.projectId, seeded.principalId],
      );
    }
  }
});

test('registered repositories support paired CODE/TEST evidence and reject foreign links and audit entities', async () => {
  const repo = await store.registerRepository(context(), randomUUID(), metadata('evidence'));
  await assert.rejects(
    pool.query('INSERT INTO repositories(id,project_id,name,url) VALUES ($1,$2,$3,$4)', [
      randomUUID(),
      seeded.projectId,
      'duplicate',
      repo.url,
    ]),
    { code: '23505' },
  );
  const otherProject = randomUUID();
  await pool.query("INSERT INTO projects(id,name) VALUES ($1,'Other evidence project')", [
    otherProject,
  ]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
    [otherProject, seeded.principalId],
  );
  const foreign = await store.registerRepository(
    { projectId: otherProject, principalId: seeded.principalId },
    randomUUID(),
    metadata('evidence'),
  );
  assert.notEqual(foreign.id, repo.id);
  await assert.rejects(
    pool.query(
      "INSERT INTO audit_events(id,project_id,seq,actor_id,entity_id,entity_type,action,payload,trace_id) VALUES ($1,$2,900000,$3,$4,'REPOSITORY','repository.invalid','{}',$5)",
      [randomUUID(), seeded.projectId, seeded.principalId, foreign.id, randomUUID()],
    ),
    { code: '23503' },
  );
  const requirement = await store.createRequirement(context(), randomUUID(), {
    title: 'Evidence test scope',
    description: 'Synthetic isolated test',
    type: 'FUNCTIONAL',
  });
  const task = await store.createTask(context(), randomUUID(), {
    title: 'Traceable implementation',
    workType: 'CODE',
    criteria: [{ id: 'c1', description: 'Paired evidence', required: true }],
    requirementIds: [requirement.id],
    primaryRequirementId: requirement.id,
  });
  const sprint = await store.createIteration(context(), randomUUID(), {
    name: 'Evidence scope',
    goal: 'Exercise evidence',
    startsOn: '2026-11-05',
    endsOn: '2026-11-19',
  });
  assert.ok(sprint.id);
  await store.assignRequirementSprint(context(), randomUUID(), requirement.id, {
    expectedVersion: requirement.version + 1,
    sprintId: sprint.id,
    reason: 'Plan evidence task',
  });
  await store.transitionIteration(context(), randomUUID(), sprint.id, {
    expectedVersion: sprint.version,
    to: 'ACTIVE',
    reason: 'Execute evidence test',
  });
  const ready = await store.transitionTask(context(), randomUUID(), task.id, {
    expectedVersion: (await pool.query('SELECT version FROM work_items WHERE id=$1', [task.id]))
      .rows[0].version,
    to: 'READY',
  });
  const agent = { projectId: seeded.projectId, principalId: seeded.agents[0]!.principalId };
  const session = await store.registerSession(agent, randomUUID(), {});
  const claim = await store.claimTask(agent, randomUUID(), task.id, {
    expectedVersion: ready.version,
    sessionId: session.id,
  });
  const input = {
    expectedVersion: claim.version,
    sessionId: session.id,
    fencingToken: claim.fencingToken,
    kind: 'CODE',
    criterionIds: ['c1'],
    commit: 'a'.repeat(40),
    url: 'https://example.test/synthetic-code',
    repositoryId: foreign.id,
  };
  await assert.rejects(store.addEvidence(agent, randomUUID(), task.id, input), {
    code: 'REPOSITORY_NOT_FOUND',
  });
  const code = await store.addEvidence(agent, randomUUID(), task.id, {
    ...input,
    repositoryId: repo.id,
  });
  await store.addEvidence(agent, randomUUID(), task.id, {
    ...input,
    expectedVersion: code.version,
    repositoryId: repo.id,
    kind: 'TEST',
    url: 'https://example.test/synthetic-test',
    result: { outcome: 'PASS', total: 1, passed: 1 },
  });
  const evidence = await pool.query(
    'SELECT kind,repository_id,commit_sha FROM evidence WHERE task_id=$1 ORDER BY kind',
    [task.id],
  );
  assert.deepEqual(evidence.rows, [
    { kind: 'CODE', repository_id: repo.id, commit_sha: 'a'.repeat(40) },
    { kind: 'TEST', repository_id: repo.id, commit_sha: 'a'.repeat(40) },
  ]);
  await store.endSession(agent, randomUUID(), session.id, {
    expectedVersion: session.version,
    reason: 'Synthetic test finished',
  });
});

test('MCP context and delta expose the registered repository without a new write tool', async () => {
  const r = await post(metadata('mcp'));
  assert.equal(r.status, 201);
  const repo = (await r.json()).data;
  const client = new Client({ name: 'repository-contract', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
        requestInit: { headers: { authorization: `Bearer ${seeded.agents[0]!.mcpToken}` } },
      }),
    );
    const tools = await client.listTools();
    assert.equal(
      tools.tools.some((tool) => /register_repository|create_repository/.test(tool.name)),
      false,
    );
    let cursor: string | undefined;
    const records: { entityType: string; data: { id: string } }[] = [];
    do {
      const page = await client.callTool({
        name: 'acc_get_context',
        arguments: {
          projectId: seeded.projectId,
          query: { limit: 100, ...(cursor ? { cursor } : {}) },
        },
      });
      assert.notEqual(page.isError, true);
      const data = (
        page.structuredContent as { data: { records: typeof records; nextCursor?: string } }
      ).data;
      records.push(...data.records);
      cursor = data.nextCursor;
    } while (cursor);
    assert.ok(
      records.some((record) => record.entityType === 'REPOSITORY' && record.data.id === repo.id),
    );
    const delta = await client.callTool({
      name: 'acc_get_changes',
      arguments: {
        projectId: seeded.projectId,
        query: { afterSeq: (BigInt(repo.projectSeq) - 1n).toString(), limit: 100 },
      },
    });
    assert.notEqual(delta.isError, true);
    const event = (
      delta.structuredContent as {
        data: { events: { entity: { id: string; type: string }; type: string }[] };
      }
    ).data.events[0]!;
    assert.equal(event.type, 'repository.registered');
    assert.deepEqual(event.entity, { id: repo.id, type: 'REPOSITORY' });
  } finally {
    await client.close();
  }
});
