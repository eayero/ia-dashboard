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
const config = loadConfiguration(process.env);
let app: Awaited<ReturnType<typeof createApplication>>, base: string;
let seeded: Awaited<ReturnType<typeof bootstrapLocal>>;
let scopedTaskId: string;
before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
  seeded = await bootstrapLocal(process.env, pool);
  app = await createApplication(config, pool);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => {
  if (app) await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
const taskInput = {
  title: 'Trabajo con alcance',
  criteria: [{ id: 'a', description: 'Verificado', required: true }],
};
async function post(path: string, input: unknown, key = randomUUID()) {
  if (
    path === '/tasks' &&
    input &&
    typeof input === 'object' &&
    'requirementIds' in input &&
    Array.isArray(input.requirementIds)
  )
    input = {
      ...input,
      primaryRequirementId:
        'primaryRequirementId' in input ? input.primaryRequirementId : input.requirementIds[0],
    };
  return fetch(`${base}/api/v1/projects/${seeded.projectId}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${seeded.agents[0]!.apiToken}`,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify(input),
  });
}
async function get(path: string) {
  const response = await fetch(`${base}/api/v1/projects/${seeded.projectId}${path}`, {
    headers: { authorization: `Bearer ${seeded.agents[0]!.apiToken}` },
  });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}
test('REST rechaza crear tareas sin requisito o con lista vacía sin dejar tareas huérfanas', async () => {
  for (const input of [taskInput, { ...taskInput, requirementIds: [] }]) {
    const response = await post('/tasks', input);
    assert.equal(response.status, 400);
  }
  assert.equal((await get('/tasks?limit=100')).items.length, 0);
});
test('REST y MCP crean tarea y vínculo inicial atómicos, con reintentos y aislamiento', async () => {
  const requirement = (
    await (
      await post('/requirements', {
        title: 'Alcance',
        description: 'Trabajo de prueba',
        type: 'FUNCTIONAL',
      })
    ).json()
  ).data;
  const response = await post('/tasks', { ...taskInput, requirementIds: [randomUUID()] });
  assert.equal(response.status, 404);
  assert.equal((await get('/tasks?limit=100')).items.length, 0);
  const key = randomUUID(),
    input = {
      ...taskInput,
      requirementIds: [requirement.id],
      primaryRequirementId: requirement.id,
      externalRef: 'task:scope',
    };
  const created = await post('/tasks', input, key);
  assert.equal(created.status, 201);
  const task = (await created.json()).data;
  scopedTaskId = task.id;
  assert.deepEqual((await (await post('/tasks', input, key)).json()).data, task);
  const detail = await get(`/tasks/${task.id}`);
  assert.deepEqual(
    detail.requirements.map((r: { id: string }) => r.id),
    [requirement.id],
  );
  assert.equal(detail.impactPending, true);
  const req = await get(`/requirements/${requirement.id}`);
  assert.equal(req.links[0].taskId, task.id);
  const client = new Client({ name: 'requirement-flow', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
        requestInit: { headers: { authorization: `Bearer ${seeded.agents[0]!.mcpToken}` } },
      }),
    );
    const tools = await client.listTools(),
      create = tools.tools.find((t) => t.name === 'acc_find_or_create_task')!;
    const schema = create.inputSchema.properties!.input as { required: string[] };
    assert.ok(schema.required.includes('requirementIds'));
    const invalid = await client.callTool({
      name: 'acc_find_or_create_task',
      arguments: { projectId: seeded.projectId, idempotencyKey: randomUUID(), input: taskInput },
    });
    assert.equal(invalid.isError, true);
    const r = await client.callTool({
      name: 'acc_find_or_create_task',
      arguments: {
        projectId: seeded.projectId,
        idempotencyKey: randomUUID(),
        input: { ...input, externalRef: 'task:mcp' },
      },
    });
    assert.notEqual(r.isError, true);
    const data = (r.structuredContent as { data: { id: string } }).data;
    assert.equal((await get(`/tasks/${data.id}`)).requirements[0].id, requirement.id);
  } finally {
    await client.close();
  }
});
test('REST impide retirar la última asociación y permite retirar una de varias', async () => {
  async function humanPost(path: string, input: unknown) {
    let r = await fetch(base + '/api/v1/auth/session');
    let csrf = (await r.json()).data.csrfToken;
    let cookie = r.headers
      .getSetCookie()
      .find((c) => c.startsWith('acc.sid='))!
      .split(';')[0]!;
    r = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers: {
        origin: config.publicOrigin,
        cookie,
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
    return fetch(`${base}/api/v1/projects/${seeded.projectId}${path}`, {
      method: 'POST',
      headers: {
        origin: config.publicOrigin,
        cookie,
        'x-csrf-token': csrf,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify(input),
    });
  }
  const ids = [];
  for (let i = 0; i < 2; i++)
    ids.push(
      (
        await (
          await post('/requirements', {
            title: 'Req ' + i,
            description: 'Alcance',
            type: 'FUNCTIONAL',
          })
        ).json()
      ).data.id,
    );
  const task = (
    await (
      await post('/tasks', { ...taskInput, requirementIds: ids, primaryRequirementId: ids[1] })
    ).json()
  ).data;
  let req = await get(`/requirements/${ids[0]}`);
  let r = await humanPost(`/requirements/${ids[0]}/link`, {
    expectedVersion: req.version,
    taskId: task.id,
    taskVersion: task.version,
    operation: 'REMOVE',
    reason: 'Otro requisito conserva alcance',
  });
  assert.equal(r.status, 201);
  const current = await get(`/tasks/${task.id}`);
  req = await get(`/requirements/${ids[1]}`);
  r = await humanPost(`/requirements/${ids[1]}/link`, {
    expectedVersion: req.version,
    taskId: task.id,
    taskVersion: current.version,
    operation: 'REMOVE',
    reason: 'Intento de dejar huérfana',
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, 'TASK_REQUIREMENT_REQUIRED');
  assert.equal((await get(`/tasks/${task.id}`)).requirements.length, 1);
});
test('un requisito ajeno se rechaza sin crear tarea y externalRef no cambia el alcance existente', async () => {
  const otherProject = randomUUID();
  await pool.query("INSERT INTO projects(id,name) VALUES ($1,'Foreign scope')", [otherProject]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
    [otherProject, seeded.principalId],
  );
  const foreign = await new CoordinationStore(pool).createRequirement(
    { projectId: otherProject, principalId: seeded.principalId },
    randomUUID(),
    { title: 'Privado', description: 'Otro proyecto', type: 'FUNCTIONAL' },
  );
  const before = (await get('/tasks?limit=100')).items.length;
  const response = await post('/tasks', { ...taskInput, requirementIds: [foreign.id] });
  assert.equal(response.status, 404);
  assert.equal((await get('/tasks?limit=100')).items.length, before);
  const requirements = (await get('/requirements?limit=100')).items;
  const original = await get(`/tasks/${scopedTaskId}`);
  const detail = await get(`/tasks/${original.id}`);
  const matched = await post('/tasks', {
    ...taskInput,
    externalRef: 'task:scope',
    requirementIds: [
      requirements.find((r: { id: string }) => r.id !== detail.requirements[0].id).id,
    ],
  });
  assert.equal((await matched.json()).data.id, original.id);
  assert.deepEqual((await get(`/tasks/${original.id}`)).requirements, detail.requirements);
});
test('fallar el outbox revierte tarea, vínculos y versiones del requisito', async () => {
  const requirement = (
    await (
      await post('/requirements', {
        title: 'Rollback',
        description: 'Transacción íntegra',
        type: 'FUNCTIONAL',
      })
    ).json()
  ).data;
  const before = (await get('/tasks?limit=100')).items.length;
  await pool.query(
    "CREATE FUNCTION fail_scope_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END $$",
  );
  await pool.query(
    'CREATE TRIGGER fail_scope_outbox BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION fail_scope_outbox()',
  );
  try {
    assert.equal(
      (await post('/tasks', { ...taskInput, requirementIds: [requirement.id] })).status,
      500,
    );
  } finally {
    await pool.query('DROP TRIGGER fail_scope_outbox ON event_outbox');
  }
  assert.equal((await get('/tasks?limit=100')).items.length, before);
  const req = await get(`/requirements/${requirement.id}`);
  assert.equal(req.links.length, 0);
  assert.equal(req.version, 1);
});
test('PostgreSQL rechaza inserción huérfana y retiro concurrente de todas las asociaciones', async () => {
  await assert.rejects(
    pool.query(
      "INSERT INTO work_items(id,project_id,public_id,title,criteria,created_by) VALUES ($1,$2,'TASK-ORPHAN','Forbidden orphan','[]',$3)",
      [randomUUID(), seeded.projectId, seeded.principalId],
    ),
    { code: '23514' },
  );
  const requirements = (await get('/requirements?limit=100')).items.slice(0, 2);
  const task = (
    await (
      await post('/tasks', {
        ...taskInput,
        requirementIds: requirements.map((r: { id: string }) => r.id),
      })
    ).json()
  ).data;
  const attempts = await Promise.allSettled(
    requirements.map((r: { id: string }) =>
      pool.query(
        'DELETE FROM requirement_task_links WHERE project_id=$1 AND requirement_id=$2 AND task_id=$3',
        [seeded.projectId, r.id, task.id],
      ),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await get(`/tasks/${task.id}`)).requirements.length, 1);
  await assert.rejects(pool.query('TRUNCATE requirement_task_links CASCADE'));
});
