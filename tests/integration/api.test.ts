import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApplication } from '../../apps/api/src/app.ts';
import { loadConfiguration } from '../../apps/api/src/config.ts';
import { bootstrapLocal } from '../../apps/api/src/local-bootstrap.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { Pool } from '../../packages/db/src/index.ts';
import { tokenWithInvalidSignature } from '../../apps/api/test/token-fixtures.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
  max: 20,
});
const config = loadConfiguration(process.env);
const origin = config.publicOrigin;
let app: Awaited<ReturnType<typeof createApplication>>;
let projectId: string;
let cookie = '';
let csrf = '';
let agents: Awaited<ReturnType<typeof bootstrapLocal>>['agents'];
before(async () => {
  assert.equal(
    origin,
    'http://localhost:55173',
    'OIDC integration requires the configured local origin',
  );
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
  const seeded = await bootstrapLocal(process.env, pool);
  projectId = seeded.projectId;
  agents = seeded.agents;
  app = await createApplication(config, pool);
  await app.listen(55173, '127.0.0.1');
  const initial = await loginCode();
  const signedIn = await fetch(initial.callback, {
    headers: { cookie: initial.pendingCookie },
    redirect: 'manual',
  });
  assert.equal(signedIn.status, 302);
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
  return fetch(`${origin}/api/v1${path}`, {
    headers: withCookie ? { cookie: withCookie } : {},
    redirect: 'manual',
  });
}
async function post(path: string, body: unknown, extra: Record<string, string> = {}) {
  return fetch(`${origin}/api/v1${path}`, {
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
async function loginCode() {
  const start = await get('/auth/login', '');
  assert.equal(start.status, 302);
  const pendingCookie = sessionCookie(start);
  const location = start.headers.get('location')!;
  const params = new URL(location).searchParams;
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.ok(params.get('state') && params.get('nonce') && params.get('code_challenge'));
  const page = await fetch(location, { redirect: 'manual' });
  assert.equal(page.status, 200);
  const html = await page.text();
  const action = /action="([^"]+)"/u.exec(html)?.[1]?.replaceAll('&amp;', '&');
  assert.ok(action, 'Keycloak login form must be present');
  const realm = JSON.parse(
    await readFile(new URL('../../.cache/keycloak/realm.json', import.meta.url), 'utf8'),
  );
  const password = realm.users.find((user: { username: string }) => user.username === 'owner')
    .credentials[0].value;
  const authorized = await fetch(action, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: page.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    },
    body: new URLSearchParams({ username: 'owner', password, credentialId: '' }),
    redirect: 'manual',
  });
  assert.equal(authorized.status, 302, 'Keycloak must authenticate the synthetic user');
  const callback = new URL(authorized.headers.get('location')!);
  assert.equal(callback.origin, origin);
  return { callback, pendingCookie };
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
test('callback rechaza state ajeno sin autenticar ni crear principal', async () => {
  const start = await get('/auth/login', '');
  const response = await get('/auth/callback?state=wrong&code=invalid', sessionCookie(start));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'OIDC_LOGIN_FAILED');
});
test('Code + PKCE real rota sesión, no persiste tokens y limita proyectos por membresía', async () => {
  const { callback, pendingCookie } = await loginCode();
  const response = await fetch(callback, {
    headers: { cookie: pendingCookie },
    redirect: 'manual',
  });
  assert.equal(response.status, 302, 'OIDC callback must succeed');
  cookie = sessionCookie(response);
  assert.ok(cookie && cookie !== pendingCookie, 'Session ID must rotate on login');
  const setCookie = response.headers.getSetCookie().join(';');
  assert.ok(setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax'));
  const me = await get('/auth/me');
  assert.equal(me.status, 200);
  const identity = (await me.json()).data;
  assert.equal(identity.principal.kind, 'HUMAN');
  const cookieMcp = await fetch(`${origin}/mcp`, {
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
        !serialized.includes('id_token'),
      'HTTP sessions must not persist OIDC tokens',
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
test('sesión ACC explícita y comandos REST recorren hasta DONE sin atajos de gates', async () => {
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
  const blocked = await command(
    'transition',
    { ...claim, expectedVersion: declared.version, to: 'IN_REVIEW' },
    422,
  );
  assert.equal(blocked.error.code, 'EVIDENCE_REQUIRED');
  const accepted = (
    await command('accept-evidence', { expectedVersion: declared.version, evidenceId: declared.id })
  ).data;
  const review = (
    await command('transition', { ...claim, expectedVersion: accepted.version, to: 'IN_REVIEW' })
  ).data;
  const reviewApproval = (
    await command('approve', {
      expectedVersion: review.version,
      workRevision: review.workRevision,
      kind: 'REVIEW',
    })
  ).data;
  const qa = (await command('transition', { expectedVersion: reviewApproval.version, to: 'IN_QA' }))
    .data;
  const qaApproval = (
    await command('approve', {
      expectedVersion: qa.version,
      workRevision: qa.workRevision,
      kind: 'QA',
    })
  ).data;
  const denied = await command(
    'transition',
    { expectedVersion: qaApproval.version, to: 'DONE' },
    422,
  );
  assert.equal(denied.error.code, 'HUMAN_APPROVAL_REQUIRED');
  const closure = (
    await command('approve', {
      expectedVersion: qaApproval.version,
      workRevision: qa.workRevision,
      kind: 'CLOSURE',
    })
  ).data;
  const complete = await command('transition', { expectedVersion: closure.version, to: 'DONE' });
  assert.equal(complete.data.status, 'DONE');
  assert.equal(complete.meta.version, complete.data.version);
  assert.ok(complete.meta.projectSeq);
  const detail = await get(`${base}/tasks/${task.id}`);
  assert.equal((await detail.json()).data.status, 'DONE');
});
test('nonce distinto y usuario OIDC no preaprovisionado nunca crean una sesión autenticada', async () => {
  const nonceFlow = await loginCode();
  await pool.query(
    "UPDATE http_sessions SET sess=jsonb_set(sess::jsonb,'{login,nonce}',to_jsonb('mismatch'::text)) WHERE sess->'login'->>'state'=$1",
    [nonceFlow.callback.searchParams.get('state')],
  );
  const denied = await fetch(nonceFlow.callback, {
    headers: { cookie: nonceFlow.pendingCookie },
    redirect: 'manual',
  });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, 'OIDC_LOGIN_FAILED');
  const mapping = (await pool.query("SELECT * FROM oidc_identities WHERE kind='HUMAN'")).rows[0];
  await pool.query('DELETE FROM oidc_identities WHERE issuer=$1 AND subject=$2', [
    mapping.issuer,
    mapping.subject,
  ]);
  try {
    const unknown = await loginCode();
    const response = await fetch(unknown.callback, {
      headers: { cookie: unknown.pendingCookie },
      redirect: 'manual',
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'IDENTITY_NOT_PROVISIONED');
    assert.equal((await get('/auth/me', sessionCookie(response))).status, 401);
  } finally {
    await pool.query(
      'INSERT INTO oidc_identities(issuer,subject,principal_id,kind) VALUES ($1,$2,$3,$4)',
      [mapping.issuer, mapping.subject, mapping.principal_id, mapping.kind],
    );
  }
});
test('dos agentes con JWT OIDC real compiten por claim y revocación del proyecto corta el acceso del token vigente', async () => {
  const tokens = await Promise.all(
    agents.map(async (agent) => {
      const response = await fetch(`${config.issuer}/protocol/openid-connect/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: agent.clientId,
          client_secret: agent.clientSecret,
        }),
      });
      assert.equal(response.status, 200, 'Synthetic service account must authenticate');
      return (await response.json()).access_token as string;
    }),
  );
  const agentPost = (index: number, path: string, body: unknown) =>
    fetch(`${origin}/api/v1${path}`, {
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
  const escalation = await fetch(`${origin}/api/v1${base}/tasks/${created.id}/approve`, {
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
  const bearerLogout = await fetch(`${origin}/api/v1/auth/logout`, {
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
    await bootstrapLocal(process.env, one);
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
  const malformed = await fetch(`${origin}/api/v1${base}`, {
    method: 'POST',
    headers,
    body: '{bad json',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
  const large = await fetch(`${origin}/api/v1${base}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'x'.repeat(40000) }),
  });
  assert.equal(large.status, 413);
  assert.equal((await large.json()).error.code, 'PAYLOAD_TOO_LARGE');
});
test('JWT con claims válidos y firma ajena se rechaza; VIEWER lee sin poder mutar', async () => {
  const subject = (
    await pool.query('SELECT subject FROM oidc_identities WHERE principal_id=$1', [
      agents[0]!.principalId,
    ])
  ).rows[0].subject;
  const token = await tokenWithInvalidSignature(config.issuer, subject);
  const forged = await fetch(`${origin}/api/v1/projects`, {
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
test('sesión de otro issuer se invalida aunque conserve una identidad preaprovisionada', async () => {
  const me = (await (await get('/auth/me')).json()).data;
  const previous = 'https://previous-provider.example.test/realm';
  await pool.query('UPDATE oidc_identities SET issuer=$1 WHERE principal_id=$2', [
    previous,
    me.principal.id,
  ]);
  await pool.query(
    "UPDATE http_sessions SET sess=jsonb_set(sess::jsonb,'{identity,issuer}',to_jsonb($1::text)) WHERE sess->'identity'->>'principalId'=$2",
    [previous, me.principal.id],
  );
  try {
    assert.equal((await get('/auth/me')).status, 401);
  } finally {
    await pool.query('UPDATE oidc_identities SET issuer=$1 WHERE principal_id=$2', [
      config.issuer,
      me.principal.id,
    ]);
    await pool.query(
      "UPDATE http_sessions SET sess=jsonb_set(sess::jsonb,'{identity,issuer}',to_jsonb($1::text)) WHERE sess->'identity'->>'principalId'=$2",
      [config.issuer, me.principal.id],
    );
  }
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
  const invalid = await fetch(`${origin}/api/v1/projects`, {
    headers: { cookie, authorization: 'Bearer invalid' },
  });
  assert.equal(invalid.status, 401);
  assert.equal((await post('/auth/logout', {})).status, 201);
  assert.equal((await get('/auth/me')).status, 401);
});
