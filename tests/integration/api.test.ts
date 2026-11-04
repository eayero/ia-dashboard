import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../../apps/api/src/app.ts';
import { loadConfiguration } from '../../apps/api/src/config.ts';
import { bootstrapLocal } from '../../apps/api/src/local-bootstrap.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { Pool } from '../../packages/db/src/index.ts';
import { restRouteInventory } from '../../apps/api/test/openapi-fixtures.ts';
import { envelope, errorModel, responseModels } from '../../apps/api/src/openapi/models.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 20,
});
const config = loadConfiguration(process.env);
const origin = config.publicOrigin;
let transportOrigin: string;
let app: Awaited<ReturnType<typeof createApplication>>;
let projectId: string;
let cookie = '';
let csrf = '';
let ownerLogin: { username: string; password: string };
let agents: Awaited<ReturnType<typeof bootstrapLocal>>['agents'];
before(async () => {
  assert.equal(
    origin,
    'http://localhost:55173',
    'Local integration requires the configured origin',
  );
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
  const seeded = await bootstrapLocal(process.env, pool);
  projectId = seeded.projectId;
  ownerLogin = { username: seeded.username, password: seeded.password };
  agents = seeded.agents;
  app = await createApplication(config, pool);
  await app.listen(0, '127.0.0.1');
  transportOrigin = app.getUrl ? await app.getUrl() : origin;
  const { response: signedIn } = await login();
  assert.equal(signedIn.status, 201);
  cookie = sessionCookie(signedIn);
  csrf = (await (await get('/auth/me')).json()).data.csrfToken;
});
after(async () => {
  if (app) await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
function sessionCookie(response: Response) {
  return (
    response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0]!)
      .find((value) => value.startsWith('acc.sid=')) ?? ''
  );
}
async function get(path: string, withCookie = cookie) {
  return fetch(`${transportOrigin}/api/v1${path}`, {
    headers: withCookie ? { cookie: withCookie } : {},
    redirect: 'manual',
  });
}

test('REST registra inicio y pausa del agente y consulta acumulado autorizado por día', async () => {
  const base = `/projects/${projectId}`,
    headers = { authorization: `Bearer ${agents[0]!.apiToken}` };
  const created = await post(`${base}/tasks`, {
    title: 'Tiempo HTTP',
    criteria: [{ id: 'a', description: 'Tiempo comprobado', required: true }],
  });
  const task = (await created.json()).data;
  const ready = (
    await (
      await post(`${base}/tasks/${task.id}/transition`, { expectedVersion: 1, to: 'READY' })
    ).json()
  ).data;
  const session = (await (await post(`${base}/agent-sessions`, {}, headers)).json()).data;
  const claim = (
    await (
      await post(
        `${base}/tasks/${task.id}/claim`,
        { expectedVersion: ready.version, sessionId: session.id },
        headers,
      )
    ).json()
  ).data;
  const lease = { sessionId: session.id, fencingToken: claim.fencingToken };
  const start = await post(
    `${base}/tasks/${task.id}/start-work`,
    { ...lease, expectedVersion: claim.version },
    headers,
  );
  assert.equal(start.status, 201);
  const started = (await start.json()).data;
  const pause = await post(
    `${base}/tasks/${task.id}/pause-work`,
    { ...lease, expectedVersion: started.version },
    headers,
  );
  assert.equal(pause.status, 201);
  const paused = (await pause.json()).data;
  const timeResponse = await get(`${base}/tasks/${task.id}/time?timeZone=UTC`);
  assert.equal(timeResponse.status, 200);
  const time = envelope(responseModels.TaskTime).parse(await timeResponse.json()).data;
  assert.equal(time.intervals.length, 1);
  assert.equal(time.agents[0]!.principalId, agents[0]!.principalId);
  assert.equal((await get(`${base}/tasks/${task.id}/time?timeZone=Not/AZone`)).status, 400);
  const cancelled = await post(`${base}/tasks/${task.id}/transition`, {
    expectedVersion: paused.version,
    to: 'CANCELLED',
    reason: 'Verificación sintética de tiempo finalizada',
  });
  assert.equal(cancelled.status, 201);
  await post(
    `${base}/agent-sessions/${session.id}/end`,
    { expectedVersion: session.version, reason: 'Fixture complete' },
    headers,
  );
});

test('REST registra requisitos, aprueba revisiones y devuelve historial y contexto', async () => {
  const path = `/projects/${projectId}/requirements`;
  const response = await post(path, {
    title: 'Requisito HTTP',
    description: 'Trazabilidad real',
    type: 'FUNCTIONAL',
  });
  assert.equal(response.status, 201);
  const requirement = (await response.json()).data;
  assert.match(requirement.publicId, /^REQ-/u);
  const approved = await post(`${path}/${requirement.id}/approve`, {
    expectedVersion: 1,
    revision: 1,
  });
  assert.equal(approved.status, 201);
  const detail = await get(`${path}/${requirement.id}`);
  assert.equal(detail.status, 200);
  const data = (await detail.json()).data;
  envelope(responseModels.RequirementDetail).parse({ data, meta: { requestId: randomUUID() } });
  assert.equal(data.approvedRevision, 1);
  assert.equal(data.revisions[0].status, 'APPROVED');
  const listed = await get(`${path}?limit=1`);
  assert.equal(listed.status, 200);
  const page = envelope(responseModels.RequirementList).parse(await listed.json());
  assert.equal(page.data.items[0]!.id, requirement.id);
  const snapshot = (await (await get(`/projects/${projectId}/context?limit=100`)).json()).data;
  assert.ok(
    snapshot.records.some(
      (r: { entityType: string; data: { id: string } }) =>
        r.entityType === 'REQUIREMENT' && r.data.id === requirement.id,
    ),
  );
  const taskResponse = await post(`/projects/${projectId}/tasks`, {
    title: 'Tarea requisito HTTP',
    criteria: [{ id: 'a', description: 'Cubrir requisito', required: true }],
  });
  const task = (await taskResponse.json()).data;
  const linkResponse = await post(`${path}/${requirement.id}/link`, {
    expectedVersion: 2,
    taskId: task.id,
    taskVersion: 1,
    operation: 'ADD',
    reason: 'Cobertura HTTP',
  });
  assert.equal(linkResponse.status, 201);
  const link = (await linkResponse.json()).data;
  const evaluated = await post(`${path}/${requirement.id}/evaluate-impact`, {
    expectedVersion: link.version,
    taskId: task.id,
    taskVersion: link.taskVersion,
    revision: 1,
    reason: 'Evaluado por humano de prueba',
  });
  assert.equal(evaluated.status, 201);
  const evaluation = (await evaluated.json()).data;
  const revised = await post(`${path}/${requirement.id}/revise`, {
    title: 'Requisito HTTP actualizado',
    description: 'Nueva propuesta',
    type: 'FUNCTIONAL',
    expectedVersion: evaluation.version,
    reason: 'Aclaración',
  });
  assert.equal(revised.status, 201);
  const agentApproval = await fetch(`${transportOrigin}/api/v1${path}/${requirement.id}/approve`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${agents[0]!.apiToken}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({ expectedVersion: (await revised.json()).data.version, revision: 2 }),
  });
  assert.equal(agentApproval.status, 403);
  const cleanup = await post(`/projects/${projectId}/tasks/${task.id}/transition`, {
    expectedVersion: evaluation.taskVersion,
    to: 'CANCELLED',
    reason: 'Finalizada verificación sintética de requisitos HTTP',
  });
  assert.equal(cleanup.status, 201);
});

test('OpenAPI público describe rutas concretas, autenticación y contrato sin datos del entorno', async () => {
  const response = await get('/openapi.json', '');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const doc = await response.json();
  assert.equal(doc.openapi, '3.1.1');
  assert.deepEqual(doc.servers, [{ url: '/' }]);
  assert.ok(doc.paths['/api/v1/projects/{projectId}/tasks/{taskId}/validate'].post);
  assert.ok(doc.paths['/api/v1/agents/{id}/projects/{projectId}'].post);
  assert.equal(JSON.stringify(doc).includes(process.env.SESSION_SECRET!), false);
  assert.equal(JSON.stringify(doc).includes(process.env.DATABASE_URL!), false);
  const documented = Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.keys(methods as object).map((method) => `${method} ${path}`),
  );
  assert.deepEqual(documented.sort(), restRouteInventory().sort());
});

test('respuestas reales REST satisfacen modelos publicados y el contrato no autoriza mutaciones', async () => {
  for (const [path, name] of [
    ['/auth/me', 'Identity'],
    ['/projects', 'Projects'],
    ['/admin/users', 'Users'],
    ['/admin/agent-identities', 'Agents'],
    ['/admin/agents', 'AgentCredentials'],
    ['/agents', 'Agents'],
    [`/projects/${projectId}/tasks`, 'TaskList'],
    [`/projects/${projectId}/agent-sessions`, 'Sessions'],
  ] as const) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    envelope(responseModels[name]).parse(await response.json());
  }
  const created = await post(`/projects/${projectId}/tasks`, {
    title: 'OpenAPI synthetic contract',
    workType: 'OTHER',
    criteria: [{ id: 'a', description: 'Contrato verificado', required: true }],
  });
  assert.equal(created.status, 201);
  const task = envelope(responseModels.CreatedTask).parse(await created.json()).data;
  envelope(responseModels.TaskDetail).parse(
    await (await get(`/projects/${projectId}/tasks/${task.id}`)).json(),
  );
  const snapshot = envelope(responseModels.Context).parse(
    await (await get(`/projects/${projectId}/context?limit=100`)).json(),
  ).data;
  assert.equal(snapshot.complete, true);
  envelope(responseModels.Changes).parse(
    await (
      await get(
        `/projects/${projectId}/events?cursor=${encodeURIComponent(snapshot.changesCursor!)}`,
      )
    ).json(),
  );
  const denied = await post(
    `/projects/${projectId}/tasks/${task.id}/transition`,
    { to: 'READY', expectedVersion: task.version },
    { 'x-csrf-token': 'wrong' },
  );
  assert.equal(denied.status, 403);
  errorModel.parse(await denied.json());
  const malformed = await post(`/projects/${projectId}/tasks`, { title: 'No criteria' });
  assert.equal(malformed.status, 400);
  errorModel.parse(await malformed.json());
  const cancelled = await post(`/projects/${projectId}/tasks/${task.id}/transition`, {
    to: 'CANCELLED',
    expectedVersion: task.version,
    reason: 'Comprobación sintética de contrato terminada',
  });
  assert.equal(cancelled.status, 201);
  envelope(responseModels.Mutation).parse(await cancelled.json());
});
async function post(path: string, body: unknown, extra: Record<string, string> = {}) {
  return fetch(`${transportOrigin}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin,
      'x-csrf-token': csrf,
      'idempotency-key': randomUUID(),
      ...extra,
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
}
async function login(input = ownerLogin) {
  const start = await get('/auth/session', '');
  assert.equal(start.status, 200);
  const pendingCookie = sessionCookie(start);
  const csrfToken = (await start.json()).data.csrfToken;
  const response = await fetch(`${transportOrigin}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      cookie: pendingCookie,
      origin,
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify(input),
  });
  return { response, pendingCookie };
}

test('HTTP exige autenticación y mantiene health y errores con envelope sin filtrar detalles', async () => {
  assert.equal((await get('/health/ready', '')).status, 200);
  const response = await get('/projects', '');
  assert.equal(response.status, 401);
  const error = await response.json();
  assert.equal(error.error.code, 'AUTH_REQUIRED');
  assert.ok(error.error.requestId);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('API no arranca ni anuncia readiness con esquema de autenticación sin migrar', async () => {
  const emptySchema = `${schema}_empty`;
  await admin.query(`CREATE SCHEMA "${emptySchema}"`);
  const bare = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${emptySchema}`,
  });
  let unexpected: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    await assert.rejects(
      async () => {
        unexpected = await createApplication(config, bare);
      },
      (error: unknown) =>
        Boolean(error && typeof error === 'object' && 'code' in error && error.code === '42P01'),
    );
  } finally {
    await unexpected?.close();
    await bare.end();
    await admin.query(`DROP SCHEMA "${emptySchema}" CASCADE`);
  }
});
test('rutas OIDC retiradas no autentican ni crean cuentas', async () => {
  assert.equal((await get('/auth/callback?state=wrong&code=invalid', '')).status, 404);
  assert.equal((await get('/auth/login', '')).status, 404);
});

test('login ACC rota sesión, no persiste contraseñas y limita proyectos por membresía', async () => {
  const { response, pendingCookie } = await login();
  assert.equal(response.status, 201);
  cookie = sessionCookie(response);
  assert.ok(cookie && cookie !== pendingCookie, 'Session ID must rotate on login');
  const setCookie = response.headers.getSetCookie().join(';');
  assert.ok(setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax'));
  const me = await get('/auth/me');
  assert.equal(me.status, 200);
  const identity = (await me.json()).data;
  assert.equal(identity.principal.kind, 'HUMAN');
  const cookieMcp = await fetch(`${transportOrigin}/mcp`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(cookieMcp.status, 401, 'BFF cookie must not authenticate an MCP agent');
  csrf = identity.csrfToken;
  assert.ok(csrf);
  assert.equal((await get('/auth/me', pendingCookie)).status, 401);
  const projects = await get('/projects');
  assert.deepEqual(
    (await projects.json()).data.map((project: { id: string }) => project.id),
    [projectId],
  );
  const stored = (
    await pool.query("SELECT sess FROM http_sessions WHERE sess->'identity' IS NOT NULL")
  ).rows;
  for (const row of stored) {
    const serialized = JSON.stringify(row.sess);
    assert.ok(
      !serialized.includes('access_token') &&
        !serialized.includes('refresh_token') &&
        !serialized.includes('id_token') &&
        !serialized.includes(ownerLogin.password) &&
        !serialized.includes('password_hash'),
      'HTTP sessions must not persist credentials',
    );
  }
});
test('HTTP rechaza Origin y CSRF incorrectos, identidad inyectada y recursos ajenos', async () => {
  const path = `/projects/${projectId}/tasks`;
  const input = {
    title: 'Prueba HTTP',
    criteria: [{ id: 'AC-1', description: 'Verifica el resultado', required: true }],
  };
  assert.equal((await post(path, input, { 'x-csrf-token': '' })).status, 403);
  assert.equal((await post(path, input, { 'x-csrf-token': 'é'.repeat(64) })).status, 403);
  assert.equal((await post(path, input, { origin: 'https://external.test' })).status, 403);
  assert.equal((await post(path, { ...input, principalId: randomUUID() })).status, 400);
  assert.equal((await post(path, input, { 'idempotency-key': '' })).status, 400);
  assert.equal((await get(`/projects/${randomUUID()}/tasks`)).status, 403);
});
test('REST completa con evidencia declarada y validación humana posterior sin cambiar estado', async () => {
  const base = `/projects/${projectId}`;
  const created = await post(`${base}/tasks`, {
    title: 'Recorrido autenticado',
    criteria: [{ id: 'AC-1', description: 'Resultado aceptado', required: true }],
  });
  assert.equal(created.status, 201);
  const task = (await created.json()).data;
  const command = async (name: string, payload: unknown, status = 201) => {
    const response = await post(`${base}/tasks/${task.id}/${name}`, payload);
    assert.equal(response.status, status, `Task command ${name}`);
    return response.json();
  };
  const ready = await command('transition', { to: 'READY', expectedVersion: task.version });
  const session = await post(`${base}/agent-sessions`, {});
  assert.equal(session.status, 201);
  const logical = (await session.json()).data;
  const lease = (
    await command('claim', { sessionId: logical.id, expectedVersion: ready.data.version })
  ).data;
  const claim = { sessionId: logical.id, fencingToken: lease.fencingToken };
  const declared = (
    await command('evidence', {
      ...claim,
      expectedVersion: lease.version,
      kind: 'OTHER',
      url: 'https://example.test/acceptance',
      criterionIds: ['AC-1'],
    })
  ).data;
  const review = (
    await command('transition', { ...claim, expectedVersion: declared.version, to: 'IN_REVIEW' })
  ).data;
  const qa = (await command('transition', { expectedVersion: review.version, to: 'IN_QA' })).data;
  const complete = await command('transition', { expectedVersion: qa.version, to: 'DONE' });
  const validation = await command('validate', {
    expectedVersion: complete.data.version,
    workRevision: complete.data.workRevision,
    note: 'Revisado por humano',
  });
  assert.equal(validation.data.status, 'DONE');
  const validationPath = `${base}/tasks/${task.id}/validate`;
  const validationBody = {
    expectedVersion: validation.data.version,
    workRevision: complete.data.workRevision,
  };
  assert.equal(
    (await post(validationPath, validationBody, { authorization: `Bearer ${agents[0]!.apiToken}` }))
      .status,
    403,
  );
  await pool.query(
    "UPDATE project_members SET roles=ARRAY['VIEWER'] WHERE project_id=$1 AND principal_id=(SELECT principal_id FROM local_users WHERE username=$2)",
    [projectId, ownerLogin.username],
  );
  try {
    assert.equal((await post(validationPath, validationBody)).status, 403);
  } finally {
    await pool.query(
      "UPDATE project_members SET roles=ARRAY['OWNER'] WHERE project_id=$1 AND principal_id=(SELECT principal_id FROM local_users WHERE username=$2)",
      [projectId, ownerLogin.username],
    );
  }
  assert.equal(validation.data.workRevision, complete.data.workRevision);
  const validatedDetail = (await (await get(`${base}/tasks/${task.id}`)).json()).data;
  assert.equal(validatedDetail.validations.length, 1);
  assert.equal(validatedDetail.validations[0].current, true);
  const context = (await (await get(`${base}/context?limit=100`)).json()).data;
  assert.ok(context.records.some((r: { entityType: string }) => r.entityType === 'VALIDATION'));
  assert.equal(complete.data.status, 'DONE');
  assert.equal(complete.meta.version, complete.data.version);
  assert.ok(complete.meta.projectSeq);
  const detail = await get(`${base}/tasks/${task.id}`);
  assert.equal((await detail.json()).data.status, 'DONE');
});
test('usuario desconocido y contraseña incorrecta devuelven el mismo error sin crear identidades', async () => {
  const count = (await pool.query('SELECT count(*) FROM principals')).rows[0].count;
  for (const input of [
    { username: 'unknown-user', password: ownerLogin.password },
    { ...ownerLogin, password: 'wrong password' },
  ]) {
    const { response } = await login(input);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'LOGIN_FAILED');
  }
  assert.equal((await pool.query('SELECT count(*) FROM principals')).rows[0].count, count);
});

test('dos agentes con credenciales ACC compiten por claim y revocación del proyecto corta el acceso del token vigente', async () => {
  const tokens = agents.map((agent) => agent.apiToken);
  const agentPost = (index: number, path: string, body: unknown) =>
    fetch(`${transportOrigin}/api/v1${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens[index]}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify(body),
    });
  const base = `/projects/${projectId}`;
  const created = (
    await (
      await post(`${base}/tasks`, {
        title: 'Conflicto entre agentes HTTP',
        criteria: [{ id: 'AC-1', description: 'Un ejecutor', required: true }],
      })
    ).json()
  ).data;
  const ready = (
    await (
      await post(`${base}/tasks/${created.id}/transition`, {
        expectedVersion: created.version,
        to: 'READY',
      })
    ).json()
  ).data;
  const sessions = await Promise.all(
    tokens.map(async (_, i) => {
      const response = await agentPost(i, `${base}/agent-sessions`, {});
      assert.equal(response.status, 201);
      return (await response.json()).data;
    }),
  );
  const claims = await Promise.all(
    tokens.map((_, i) =>
      agentPost(i, `${base}/tasks/${created.id}/claim`, {
        sessionId: sessions[i].id,
        expectedVersion: ready.version,
      }),
    ),
  );
  assert.deepEqual(claims.map((response) => response.status).sort(), [201, 409]);
  const winner = claims.findIndex((response) => response.status === 201);
  const lease = (await claims[winner]!.json()).data;
  const escalation = await fetch(`${transportOrigin}/api/v1${base}/tasks/${created.id}/approve`, {
    method: 'POST',
    headers: {
      cookie,
      authorization: `Bearer ${tokens[winner]}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({ expectedVersion: lease.version, workRevision: 1, kind: 'REVIEW' }),
  });
  assert.equal(escalation.status, 403, 'Bearer identity must not inherit browser privileges');
  const bearerLogout = await fetch(`${transportOrigin}/api/v1/auth/logout`, {
    method: 'POST',
    headers: {
      cookie,
      authorization: `Bearer ${tokens[winner]}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(bearerLogout.status, 403, 'Bearer request must not destroy a browser session');
  const loser = (await claims[1 - winner]!.json()).error;
  assert.equal(loser.code, 'TASK_ALREADY_CLAIMED');
  const identity = agents[winner]!;
  const revoked = await post(`${base}/agents/${identity.principalId}/revoke`, {
    expectedVersion: 1,
    reason: 'Finalizar acceso de desarrollo',
  });
  assert.equal(revoked.status, 201);
  const stale = await agentPost(winner, `${base}/tasks/${created.id}/heartbeat`, {
    sessionId: sessions[winner].id,
    fencingToken: lease.fencingToken,
    expectedVersion: lease.version,
  });
  assert.equal(stale.status, 403);
  assert.equal(
    (await pool.query('SELECT revoked FROM task_claims WHERE task_id=$1', [created.id])).rows[0]
      .revoked,
    true,
  );
  assert.equal(
    (
      await pool.query('SELECT ended_at IS NOT NULL AS ended FROM agent_sessions WHERE id=$1', [
        sessions[winner].id,
      ])
    ).rows[0].ended,
    true,
  );
});
test('bootstrap repetido usa una conexión y no reactiva accesos revocados', async () => {
  const one = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
    max: 1,
    connectionTimeoutMillis: 500,
  });
  try {
    await bootstrapLocal(process.env, one, { ...ownerLogin, cachedAgents: agents });
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM project_members WHERE project_id=$1 AND NOT active',
          [projectId],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await one.end();
  }
});
test('paginación firmada no repite tareas y rechaza cursor manipulado, JSON inválido y cuerpos excesivos', async () => {
  const base = `/projects/${projectId}/tasks`;
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await post(base, {
          title: `Paginación ${i}`,
          criteria: [{ id: 'a', description: 'Visible', required: true }],
        })
      ).status,
      201,
    );
  const ids: string[] = [];
  let cursor: string | null = null;
  let firstCursor: string | undefined;
  do {
    const response = await get(
      `${base}?limit=1&status=BACKLOG${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    ids.push(...data.items.map((task: { id: string }) => task.id));
    cursor = data.nextCursor;
    if (cursor && !firstCursor) firstCursor = cursor;
  } while (cursor);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.ok(firstCursor);
  assert.equal((await get(`${base}?limit=1&status=DONE&cursor=${firstCursor}`)).status, 400);
  assert.equal((await get(`${base}?cursor=invalid`)).status, 400);
  const headers = {
    cookie,
    origin,
    'x-csrf-token': csrf,
    'content-type': 'application/json',
    'idempotency-key': randomUUID(),
  };
  const malformed = await fetch(`${transportOrigin}/api/v1${base}`, {
    method: 'POST',
    headers,
    body: '{bad json',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  const large = await fetch(`${transportOrigin}/api/v1${base}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'x'.repeat(40000) }),
  });
  assert.equal(large.status, 413);
  assert.equal((await large.json()).error.code, 'PAYLOAD_TOO_LARGE');
});
test('credencial alterada se rechaza; VIEWER lee sin poder mutar', async () => {
  const token = `acc_${randomUUID()}.${'x'.repeat(43)}`;
  const forged = await fetch(`${transportOrigin}/api/v1/projects`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(forged.status, 401);
  const me = (await (await get('/auth/me')).json()).data;
  await pool.query(
    "UPDATE project_members SET roles=ARRAY['VIEWER'] WHERE project_id=$1 AND principal_id=$2",
    [projectId, me.principal.id],
  );
  try {
    assert.equal((await get(`/projects/${projectId}/tasks`)).status, 200);
    assert.equal(
      (
        await post(`/projects/${projectId}/tasks`, {
          title: 'Debe rechazarse',
          criteria: [{ id: 'a', description: 'Sin escritura', required: true }],
        })
      ).status,
      403,
    );
  } finally {
    await pool.query(
      "UPDATE project_members SET roles=ARRAY['OWNER'] WHERE project_id=$1 AND principal_id=$2",
      [projectId, me.principal.id],
    );
  }
});
test('cambiar versión de credenciales invalida la cookie anterior', async () => {
  const me = (await (await get('/auth/me')).json()).data;
  await pool.query(
    'UPDATE local_users SET credential_version=credential_version+1 WHERE principal_id=$1',
    [me.principal.id],
  );
  assert.equal((await get('/projects')).status, 401);
  const { response } = await login();
  assert.equal(response.status, 201);
  cookie = sessionCookie(response);
  csrf = (await (await get('/auth/me')).json()).data.csrfToken;
});

test('HTTP entrega contexto paginado y delta; expirar snapshot pide recarga explícita', async () => {
  const base = `/projects/${projectId}`;
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await post(`${base}/tasks`, {
          title: `Contexto HTTP ${i}`,
          criteria: [{ id: 'a', description: 'Contexto verificable', required: true }],
        })
      ).status,
      201,
    );
  const response = await get(`${base}/context?limit=1`);
  assert.equal(response.status, 200);
  const first = (await response.json()).data;
  assert.equal(first.complete, false);
  assert.equal(first.changesCursor, null);
  assert.ok(first.nextCursor);
  const second = await get(`${base}/context?cursor=${encodeURIComponent(first.nextCursor)}`);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).data.projectSeq, first.projectSeq);
  const events = await get(`${base}/events?afterSeq=0&limit=1`);
  assert.equal(events.status, 200);
  const data = (await events.json()).data;
  assert.equal(typeof data.events[0].seq, 'string');
  assert.ok(data.nextCursor);
  await pool.query(
    "UPDATE context_snapshots SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [first.snapshotId],
  );
  const expired = await get(`${base}/context?cursor=${encodeURIComponent(first.nextCursor)}`);
  assert.equal(expired.status, 409);
  const error = (await expired.json()).error;
  assert.equal(error.code, 'CONTEXT_EXPIRED');
  assert.equal(error.details.snapshotRequired, true);
  assert.equal((await get(`${base}/events?afterSeq=9223372036854775807`)).status, 409);
  assert.equal((await get(`/projects/${randomUUID()}/context`)).status, 403);
});
test('logout invalida cookie y acceso; bearer inválido no cae a la sesión humana', async () => {
  const invalid = await fetch(`${transportOrigin}/api/v1/projects`, {
    headers: { cookie, authorization: 'Bearer invalid' },
  });
  assert.equal(invalid.status, 401);
  assert.equal((await post('/auth/logout', {})).status, 201);
  assert.equal((await get('/auth/me')).status, 401);
});
