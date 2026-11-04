import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { CoordinationStore, Pool } from '../../packages/db/src/index.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { createApplication } from '../../apps/api/src/app.ts';
import { loadConfiguration } from '../../apps/api/src/config.ts';
import { bootstrapLocal } from '../../apps/api/src/local-bootstrap.ts';
import { Client, StreamableHTTPClientTransport } from '../../apps/api/test/mcp-client.ts';
import { mcpTokenFixture } from '../../apps/api/test/mcp-token-fixtures.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const config = loadConfiguration(process.env);
let app: Awaited<ReturnType<typeof createApplication>>;
let base: string;
let seeded: Awaited<ReturnType<typeof bootstrapLocal>>;
let tokens: string[];
before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
  seeded = await bootstrapLocal(process.env, pool);
  app = await createApplication(config, pool);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  tokens = seeded.agents.map((agent) => agent.mcpToken);
});
after(async () => {
  if (app) await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'acc-integration', version: '1.0.0' },
  },
};
function rpc(body: unknown = initialize, headers: Record<string, string> = {}) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('MCP exige Bearer y publica discovery del recurso sin confiar en Host', async () => {
  const response = await rpc();
  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get('www-authenticate'),
    `Bearer resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource/mcp"`,
  );
  const discovery = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`, {
    headers: { host: 'untrusted.example' },
  });
  assert.equal(discovery.status, 200);
  assert.deepEqual(await discovery.json(), {
    resource: `${config.publicOrigin}/mcp`,
    bearer_methods_supported: ['header'],
    scopes_supported: ['task:read', 'task:write'],
  });
});

test('MCP valida Origin y negocia inicialización sin crear sesión ACC ni transporte persistente', async () => {
  const beforeCount = (await pool.query('SELECT count(*) FROM agent_sessions')).rows[0].count;
  const forbidden = await rpc(initialize, {
    authorization: `Bearer ${tokens[0]}`,
    origin: 'https://untrusted.example',
  });
  assert.equal(forbidden.status, 403);
  const response = await rpc(initialize, {
    authorization: `Bearer ${tokens[0]}`,
    origin: config.publicOrigin,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.serverInfo.name, 'acc');
  assert.ok(body.result.capabilities.tools);
  assert.equal(response.headers.get('mcp-session-id'), null);
  assert.equal(
    (await pool.query('SELECT count(*) FROM agent_sessions')).rows[0].count,
    beforeCount,
  );
  for (const method of ['GET', 'DELETE']) {
    const unsupported = await fetch(`${base}/mcp`, {
      method,
      headers: { authorization: `Bearer ${tokens[0]}` },
    });
    assert.equal(unsupported.status, 405);
  }
});

async function client(index = 0) {
  const connection = new Client({ name: 'acc-sdk-smoke', version: '1.0.0' });
  await connection.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${tokens[index]}` } },
    }),
  );
  return connection;
}

test('MCP inicia/pausa tiempo explícito del agente y consulta su desglose diario', async () => {
  const connection = await client();
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await connection.callTool({
        name,
        arguments: { projectId: seeded.projectId, ...args },
      });
      assert.notEqual(r.isError, true, JSON.stringify(r.content));
      return (r.structuredContent as { data: Record<string, unknown> }).data;
    };
    const task = await call('acc_find_or_create_task', {
      idempotencyKey: randomUUID(),
      input: {
        title: 'MCP timed work',
        criteria: [{ id: 'a', description: 'Timer', required: true }],
      },
    });
    const ready = await call('acc_transition_task', {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      input: { expectedVersion: task.version, to: 'READY' },
    });
    const session = await call('acc_register_session', { idempotencyKey: randomUUID(), input: {} });
    const claim = await call('acc_claim_task', {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      input: { expectedVersion: ready.version, sessionId: session.id },
    });
    const lease = { sessionId: session.id, fencingToken: claim.fencingToken };
    const args = {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      input: { ...lease, expectedVersion: claim.version },
    };
    const start = await call('acc_start_work', args);
    assert.equal((await call('acc_start_work', args)).id, start.id);
    const pause = await call('acc_pause_work', {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      input: { ...lease, expectedVersion: start.version },
    });
    const time = await call('acc_get_task_time', {
      taskId: task.id,
      query: { timeZone: 'America/Caracas' },
    });
    assert.equal((time.intervals as unknown[]).length, 1);
    await call('acc_transition_task', {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      input: {
        ...lease,
        expectedVersion: pause.version,
        to: 'CANCELLED',
        reason: 'Synthetic timer check complete',
      },
    });
    await call('acc_end_session', {
      sessionId: session.id,
      idempotencyKey: randomUUID(),
      input: { expectedVersion: session.version, reason: 'Fixture complete' },
    });
  } finally {
    await connection.close();
  }
});

test('MCP propone requisitos versionados, consulta historial y no expone aprobación humana', async () => {
  const connection = await client();
  try {
    const names = (await connection.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('acc_register_requirement'));
    assert.equal(names.includes('acc_approve_requirement'), false);
    const created = await connection.callTool({
      name: 'acc_register_requirement',
      arguments: {
        projectId: seeded.projectId,
        idempotencyKey: randomUUID(),
        input: { title: 'MCP requirement', description: 'Real SDK', type: 'FUNCTIONAL' },
      },
    });
    assert.notEqual(created.isError, true);
    const data = (created.structuredContent as { data: { id: string; version: number } }).data;
    const revised = await connection.callTool({
      name: 'acc_revise_requirement',
      arguments: {
        projectId: seeded.projectId,
        requirementId: data.id,
        idempotencyKey: randomUUID(),
        input: {
          title: 'MCP revised',
          description: 'Real SDK revision',
          type: 'FUNCTIONAL',
          expectedVersion: data.version,
          reason: 'Clarification',
        },
      },
    });
    assert.notEqual(revised.isError, true);
    const detail = await connection.callTool({
      name: 'acc_get_requirement',
      arguments: { projectId: seeded.projectId, requirementId: data.id },
    });
    assert.equal(
      (detail.structuredContent as { data: { revisions: unknown[] } }).data.revisions.length,
      2,
    );
    const list = await connection.callTool({
      name: 'acc_list_requirements',
      arguments: { projectId: seeded.projectId, query: { limit: 1 } },
    });
    assert.notEqual(list.isError, true);
  } finally {
    await connection.close();
  }
});

test('cliente oficial descubre contratos estrictos y usa contexto, tareas, sesiones y delta', async () => {
  const connection = await client();
  try {
    const tools = (await connection.listTools()).tools;
    const create = tools.find((tool) => tool.name === 'acc_find_or_create_task');
    assert.ok(create);
    assert.equal(create.inputSchema.additionalProperties, false);
    assert.equal(create.annotations?.readOnlyHint, false);
    const query = tools.find((tool) => tool.name === 'acc_get_context');
    assert.equal(query?.annotations?.readOnlyHint, true);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await connection.callTool({
        name,
        arguments: { projectId: seeded.projectId, ...args },
      });
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      return result.structuredContent as {
        data: Record<string, unknown>;
        meta: { requestId: string };
      };
    };
    const context = await call('acc_get_context', { query: { limit: 100 } });
    assert.equal(context.data.complete, true);
    const input = {
      title: 'MCP synthetic',
      externalRef: `mcp:${randomUUID()}`,
      criteria: [{ id: 'AC-1', description: 'Observed by real client', required: true }],
    };
    const args = { idempotencyKey: randomUUID(), input };
    const created = await call('acc_find_or_create_task', args);
    const replay = await call('acc_find_or_create_task', args);
    assert.equal(replay.data.id, created.data.id);
    const matched = await call('acc_find_or_create_task', {
      ...args,
      idempotencyKey: randomUUID(),
    });
    assert.equal(matched.data.id, created.data.id);
    const listed = await call('acc_list_tasks', { query: {} });
    assert.ok((listed.data.items as { id: string }[]).some((item) => item.id === created.data.id));
    const session = await call('acc_register_session', { idempotencyKey: randomUUID(), input: {} });
    const heartbeat = await call('acc_heartbeat_session', {
      sessionId: session.data.id,
      idempotencyKey: randomUUID(),
      input: { expectedVersion: session.data.version },
    });
    assert.equal(heartbeat.data.version, 2);
    const ended = await call('acc_end_session', {
      sessionId: session.data.id,
      idempotencyKey: randomUUID(),
      input: { expectedVersion: heartbeat.data.version, reason: 'Synthetic check finished' },
    });
    assert.equal(ended.data.version, 3);
    const delta = await call('acc_get_changes', { query: { cursor: context.data.changesCursor } });
    assert.ok(
      (delta.data.events as { type: string }[]).some((event) => event.type === 'task.created'),
    );
    assert.ok(created.meta.requestId);
  } finally {
    await connection.close();
  }
});

test('MCP devuelve errores estructurados y no permite identidad inyectada ni objetos ajenos', async () => {
  const connection = await client();
  try {
    for (const [args, code] of [
      [{ projectId: seeded.projectId, principalId: randomUUID(), query: {} }, 'VALIDATION_ERROR'],
      [{ projectId: randomUUID(), query: {} }, 'FORBIDDEN'],
    ] as const) {
      const result = await connection.callTool({ name: 'acc_list_tasks', arguments: args });
      assert.equal(result.isError, true);
      const error = (result.structuredContent as { error: { code: string; requestId: string } })
        .error;
      assert.equal(error.code, code);
      assert.ok(error.requestId);
    }
    const invalid = await connection.callTool({
      name: 'acc_find_or_create_task',
      arguments: {
        projectId: seeded.projectId,
        idempotencyKey: randomUUID(),
        input: { title: 'Invalid', criteria: [] },
      },
    });
    assert.equal(invalid.isError, true);
    assert.equal(
      (invalid.structuredContent as { error: { code: string } }).error.code,
      'VALIDATION_ERROR',
    );
    assert.equal(
      (await pool.query("SELECT count(*) FROM work_items WHERE title='Invalid'")).rows[0].count,
      '0',
    );
  } finally {
    await connection.close();
  }
});

test('MCP rechaza audiencia REST y limita herramientas según scopes de credencial aun con membresía de escritura', async () => {
  const agent = seeded.agents[0]!;
  const restToken = agent.apiToken;
  assert.equal((await rpc(initialize, { authorization: `Bearer ${restToken}` })).status, 401);
  assert.equal(
    (await fetch(`${base}/api/v1/projects`, { headers: { authorization: `Bearer ${restToken}` } }))
      .status,
    200,
  );
  const fixture = await mcpTokenFixture(pool, ['mcp'], ['task:read']);
  const principalId = fixture.principalId;
  let connection: Client | undefined;
  try {
    await pool.query(
      "INSERT INTO project_members(project_id,principal_id,scopes) VALUES ($1,$2,ARRAY['task:read','task:write'])",
      [seeded.projectId, principalId],
    );
    connection = new Client({ name: 'read-only-check', version: '1.0.0' });
    await connection.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${fixture.token}` } },
      }),
    );
    const read = await connection.callTool({
      name: 'acc_list_tasks',
      arguments: { projectId: seeded.projectId, query: {} },
    });
    assert.notEqual(read.isError, true);
    const before = (await pool.query('SELECT count(*) FROM agent_sessions')).rows[0].count;
    const write = await rpc(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'acc_register_session',
          arguments: { projectId: seeded.projectId, idempotencyKey: randomUUID(), input: {} },
        },
      },
      { authorization: `Bearer ${fixture.token}` },
    );
    assert.equal(write.status, 403);
    assert.match(write.headers.get('www-authenticate') ?? '', /error="insufficient_scope"/u);
    assert.match(write.headers.get('www-authenticate') ?? '', /scope="task:read task:write"/u);
    assert.equal((await write.json()).error.code, 'FORBIDDEN');
    assert.equal((await pool.query('SELECT count(*) FROM agent_sessions')).rows[0].count, before);
  } finally {
    await connection?.close();
  }
});

test('dos clientes MCP compiten por claim y el agente recorre READY hasta DONE sin aprobaciones', async () => {
  const connections = await Promise.all([client(0), client(1)]);
  const projectId = randomUUID();
  const store = new CoordinationStore(pool);
  const owner = { projectId, principalId: seeded.principalId };
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [
    projectId,
    'MCP workflow synthetic',
  ]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
    [projectId, owner.principalId],
  );
  for (const agent of seeded.agents)
    await pool.query(
      "INSERT INTO project_members(project_id,principal_id,scopes) VALUES ($1,$2,ARRAY['task:read','task:write'])",
      [projectId, agent.principalId],
    );
  async function call(
    index: number,
    name: string,
    args: Record<string, unknown>,
    expectedError?: string,
  ) {
    const result = await connections[index]!.callTool({
      name,
      arguments: { projectId, idempotencyKey: randomUUID(), ...args },
    });
    const body = result.structuredContent as {
      data: Record<string, unknown>;
      error: { code: string };
    };
    if (expectedError) {
      assert.equal(result.isError, true);
      assert.equal(body.error.code, expectedError);
    } else assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return body.data;
  }
  try {
    const created = await call(0, 'acc_find_or_create_task', {
      input: {
        title: 'MCP race',
        criteria: [{ id: 'AC-1', description: 'Accepted result', required: true }],
      },
    });
    const taskId = created.id as string;
    const ready = await call(0, 'acc_transition_task', {
      taskId,
      input: { expectedVersion: created.version, to: 'READY' },
    });
    const sessions = await Promise.all(
      [0, 1].map((i) => call(i, 'acc_register_session', { input: {} })),
    );
    const attempts = await Promise.all(
      connections.map((connection, i) =>
        connection.callTool({
          name: 'acc_claim_task',
          arguments: {
            projectId,
            taskId,
            idempotencyKey: randomUUID(),
            input: { sessionId: sessions[i]!.id, expectedVersion: ready.version },
          },
        }),
      ),
    );
    assert.equal(attempts.filter((result) => !result.isError).length, 1);
    const winner = attempts.findIndex((result) => !result.isError);
    const loser = 1 - winner;
    assert.equal(
      (attempts[loser]!.structuredContent as { error: { code: string } }).error.code,
      'TASK_ALREADY_CLAIMED',
    );
    let lease = (attempts[winner]!.structuredContent as { data: Record<string, unknown> }).data;
    const sessionId = sessions[winner]!.id;
    const claimInput = () => ({
      sessionId,
      fencingToken: lease.fencingToken,
      expectedVersion: lease.version,
    });
    await call(
      loser,
      'acc_update_task',
      {
        taskId,
        input: { ...claimInput(), sessionId: sessions[loser]!.id, summary: 'Forged ownership' },
      },
      'STALE_CLAIM',
    );
    lease = await call(winner, 'acc_heartbeat_task', { taskId, input: claimInput() });
    const released = await call(winner, 'acc_release_task', { taskId, input: claimInput() });
    const oldToken = lease.fencingToken;
    lease = await call(winner, 'acc_claim_task', {
      taskId,
      input: { sessionId, expectedVersion: released.version },
    });
    assert.ok(BigInt(lease.fencingToken as string) > BigInt(oldToken as string));
    await call(
      winner,
      'acc_heartbeat_task',
      { taskId, input: { ...claimInput(), fencingToken: oldToken } },
      'STALE_CLAIM',
    );
    const updated = await call(winner, 'acc_update_task', {
      taskId,
      input: { ...claimInput(), summary: 'Implementation observed over MCP' },
    });
    lease = { ...lease, version: updated.version };
    const evidence = await call(winner, 'acc_add_evidence', {
      taskId,
      input: {
        ...claimInput(),
        kind: 'OTHER',
        url: 'https://example.test/mcp-report',
        criterionIds: ['AC-1'],
      },
    });
    lease = { ...lease, version: evidence.version };
    const review = await call(winner, 'acc_transition_task', {
      taskId,
      input: { ...claimInput(), to: 'IN_REVIEW' },
    });
    const qa = await call(winner, 'acc_transition_task', {
      taskId,
      input: { expectedVersion: review.version, to: 'IN_QA' },
    });
    const done = await call(winner, 'acc_transition_task', {
      taskId,
      input: { expectedVersion: qa.version, to: 'DONE' },
    });
    await assert.rejects(
      store.validateTask(
        { projectId, principalId: seeded.agents[winner]!.principalId },
        randomUUID(),
        taskId,
        { expectedVersion: done.version, workRevision: updated.workRevision },
      ),
      { code: 'FORBIDDEN' },
    );
    const validated = await store.validateTask(owner, randomUUID(), taskId, {
      expectedVersion: done.version,
      workRevision: updated.workRevision,
    });
    assert.equal(validated.status, 'DONE');
    assert.equal(done.status, 'DONE');
    const observed = await connections[winner]!.callTool({
      name: 'acc_get_task',
      arguments: { projectId, taskId },
    });
    assert.equal((observed.structuredContent as { data: { status: string } }).data.status, 'DONE');
  } finally {
    await Promise.all(connections.map((connection) => connection.close()));
  }
});

test('revocar membresía bloquea próximas llamadas del mismo cliente MCP y replays idempotentes', async () => {
  const connection = await client();
  const projectId = randomUUID();
  const principalId = seeded.agents[0]!.principalId;
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [
    projectId,
    'MCP revoke synthetic',
  ]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,scopes) VALUES ($1,$2,ARRAY['task:read','task:write'])",
    [projectId, principalId],
  );
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
    [projectId, seeded.principalId],
  );
  const args = { projectId, idempotencyKey: randomUUID(), input: {} };
  try {
    assert.notEqual(
      (await connection.callTool({ name: 'acc_register_session', arguments: args })).isError,
      true,
    );
    await pool.query(
      'UPDATE project_members SET active=false WHERE project_id=$1 AND principal_id=$2',
      [projectId, principalId],
    );
    for (const [name, arguments_] of [
      ['acc_register_session', args],
      ['acc_get_context', { projectId, query: {} }],
    ] as const) {
      const result = await connection.callTool({ name, arguments: arguments_ });
      assert.equal(result.isError, true);
      assert.equal(
        (result.structuredContent as { error: { code: string } }).error.code,
        'FORBIDDEN',
      );
    }
  } finally {
    await connection.close();
  }
});
