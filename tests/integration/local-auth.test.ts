import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Pool, CoordinationStore } from '../../packages/db/src/index.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { createApplication } from '../../apps/api/src/app.ts';
import { loadConfiguration } from '../../apps/api/src/config.ts';
import { hashPassword } from '../../apps/api/src/auth/password.ts';
const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const config = loadConfiguration(process.env);
const userId = randomUUID();
const password = 'synthetic local password 123456';
let app: Awaited<ReturnType<typeof createApplication>>;
let origin: string;
before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [userId]);
  await pool.query(
    "INSERT INTO local_users(principal_id,username,display_name,password_hash,system_role,must_change_password) VALUES ($1,'local-admin','Synthetic Admin',$2,'ADMIN',false)",
    [userId, await hashPassword(password)],
  );
  app = await createApplication(config, pool);
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
after(async () => {
  if (app) await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
function cookie(response: Response) {
  return (
    response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .find((value) => value?.startsWith('acc.sid=')) ?? ''
  );
}
async function start() {
  const response = await fetch(`${origin}/api/v1/auth/session`);
  assert.equal(response.status, 200);
  return { cookie: cookie(response), csrf: (await response.json()).data.csrfToken as string };
}
async function post(path: string, body: unknown, session: { cookie: string; csrf: string }) {
  return fetch(`${origin}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: config.publicOrigin,
      cookie: session.cookie,
      'x-csrf-token': session.csrf,
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
test('login local exige CSRF, rota cookie y solo persiste identidad/versiones sin contraseñas', async () => {
  const initial = await start();
  assert.equal(
    (await post('/auth/login', { username: 'local-admin', password }, { ...initial, csrf: '' }))
      .status,
    403,
  );
  const response = await post('/auth/login', { username: 'LOCAL-ADMIN', password }, initial);
  assert.equal(response.status, 201);
  const signed = cookie(response);
  assert.ok(signed && signed !== initial.cookie);
  const me = await fetch(`${origin}/api/v1/auth/me`, { headers: { cookie: signed } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.principal.id, userId);
  assert.equal(
    (await fetch(`${origin}/api/v1/auth/me`, { headers: { cookie: initial.cookie } })).status,
    401,
  );
  const sessions = (await pool.query('SELECT sess FROM http_sessions')).rows;
  assert.equal(JSON.stringify(sessions).includes(password), false);
  assert.equal(JSON.stringify(sessions).includes('password_hash'), false);
});

async function signIn(username = 'local-admin', secret = password) {
  const response = await post('/auth/login', { username, password: secret }, await start());
  assert.equal(response.status, 201);
  const data = (await response.json()).data;
  return { cookie: cookie(response), csrf: data.csrfToken as string, data };
}
const get = (path: string, session: { cookie: string }) =>
  fetch(`${origin}/api/v1${path}`, { headers: { cookie: session.cookie } });
async function createUser(session: { cookie: string; csrf: string }, role = 'USER') {
  const username = `user-${randomUUID().slice(0, 8)}`;
  const response = await post(
    '/admin/users',
    { username, displayName: 'Synthetic User', password, systemRole: role },
    session,
  );
  assert.equal(response.status, 201);
  return { ...(await response.json()).data, username } as { id: string; username: string };
}

test('administrador crea usuarios, asigna proyectos y obliga a cambiar contraseña sin escalar privilegios', async () => {
  const adminSession = await signIn();
  const user = await createUser(adminSession);
  const projectId = randomUUID();
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [
    projectId,
    'Local auth assignment',
  ]);
  const assignment = await post(
    `/admin/users/${user.id}/projects/${projectId}`,
    { active: true, roles: ['VIEWER'] },
    adminSession,
  );
  assert.equal(assignment.status, 201);
  const initial = await signIn(user.username);
  assert.equal(initial.data.user.mustChangePassword, true);
  assert.equal((await get('/projects', initial)).status, 403);
  const reused = await post(
    '/auth/password',
    { currentPassword: password, newPassword: password },
    initial,
  );
  assert.equal(reused.status, 400);
  assert.equal((await reused.json()).error.code, 'PASSWORD_UNCHANGED');
  assert.equal((await (await get('/auth/me', initial)).json()).data.user.mustChangePassword, true);
  assert.equal((await get('/projects', initial)).status, 403);
  const changed = await post(
    '/auth/password',
    { currentPassword: password, newPassword: `${password}-changed` },
    initial,
  );
  assert.equal(changed.status, 201);
  const final = { cookie: cookie(changed), csrf: (await changed.json()).data.csrfToken as string };
  assert.notEqual(final.cookie, initial.cookie);
  assert.equal((await get('/auth/me', initial)).status, 401);
  assert.deepEqual(
    (await (await get('/projects', final)).json()).data.map((p: { id: string }) => p.id),
    [projectId],
  );
  assert.equal((await get('/admin/users', final)).status, 403);
  assert.equal(
    (
      await post(
        `/admin/users/${user.id}/projects/${projectId}`,
        { active: true, roles: ['OWNER'] },
        final,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        `/projects/${projectId}/tasks`,
        { title: 'Denied', criteria: [{ id: 'c', description: 'Denied', required: true }] },
        final,
      )
    ).status,
    403,
  );
  const list = await (await get('/admin/users', adminSession)).json();
  const found = list.data.users.find((item: { id: string }) => item.id === user.id);
  assert.equal(found.projects[0].id, projectId);
  assert.deepEqual(found.projects[0].roles, ['VIEWER']);
  assert.equal(JSON.stringify(list).includes('password_hash'), false);
  const audit = await pool.query('SELECT payload FROM audit_events WHERE project_id=$1', [
    projectId,
  ]);
  assert.equal(audit.rows.length, 1);
  assert.equal(JSON.stringify(audit.rows).includes(password), false);
});

test('restablecer contraseña revoca todas las cookies y protege auditoría transaccional', async () => {
  const adminSession = await signIn();
  const user = await createUser(adminSession);
  const oldSession = await signIn(user.username);
  const before = (
    await pool.query(
      'SELECT password_hash,credential_version FROM local_users WHERE principal_id=$1',
      [user.id],
    )
  ).rows[0];
  await pool.query(
    "CREATE FUNCTION reject_reset_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PASSWORD_RESET' THEN RAISE EXCEPTION 'Synthetic reset audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_reset_fixture BEFORE INSERT ON security_events FOR EACH ROW EXECUTE FUNCTION reject_reset_fixture()",
  );
  try {
    assert.equal(
      (
        await post(
          `/admin/users/${user.id}/password`,
          { password: `${password}-reset` },
          adminSession,
        )
      ).status,
      500,
    );
  } finally {
    await pool.query(
      'DROP TRIGGER reject_reset_fixture ON security_events; DROP FUNCTION reject_reset_fixture()',
    );
  }
  assert.deepEqual(
    (
      await pool.query(
        'SELECT password_hash,credential_version FROM local_users WHERE principal_id=$1',
        [user.id],
      )
    ).rows[0],
    before,
  );
  assert.equal(
    (
      await post(
        `/admin/users/${user.id}/password`,
        { password: `${password}-reset` },
        adminSession,
      )
    ).status,
    201,
  );
  assert.equal((await get('/auth/me', oldSession)).status, 401);
  const reset = await signIn(user.username, `${password}-reset`);
  assert.equal(reset.data.user.mustChangePassword, true);
  assert.equal(
    (await post(`/admin/users/${userId}/password`, { password }, adminSession)).status,
    409,
  );
});

test('deshabilitar usuarios invalida sesión y no permite dejar un proyecto sin propietario', async () => {
  const adminSession = await signIn();
  const user = await createUser(adminSession);
  const projectId = randomUUID();
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [projectId, 'Owner protection']);
  await post(
    `/admin/users/${user.id}/projects/${projectId}`,
    { active: true, roles: ['OWNER'] },
    adminSession,
  );
  const lastOwner = await post(
    `/admin/users/${user.id}/projects/${projectId}`,
    { active: false, roles: ['OWNER'], expectedVersion: 1 },
    adminSession,
  );
  assert.equal(lastOwner.status, 409);
  assert.equal((await lastOwner.json()).error.code, 'LAST_PROJECT_OWNER');
  const old = await signIn(user.username);
  const denied = await post(`/admin/users/${user.id}/status`, { disabled: true }, adminSession);
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).error.code, 'LAST_PROJECT_OWNER');
  await post(
    `/admin/users/${userId}/projects/${projectId}`,
    { active: true, roles: ['OWNER'] },
    adminSession,
  );
  assert.equal(
    (await post(`/admin/users/${user.id}/status`, { disabled: true }, adminSession)).status,
    201,
  );
  assert.equal((await get('/auth/me', old)).status, 401);
  assert.equal(
    (await post(`/admin/users/${user.id}/status`, { disabled: false }, adminSession)).status,
    201,
  );
  assert.equal((await get('/auth/me', old)).status, 401);
  assert.equal(
    (await post(`/admin/users/${userId}/status`, { disabled: true }, adminSession)).status,
    409,
  );
});

test('credencial de agente solo se devuelve una vez y revocarla corta peticiones, sesiones y claims', async () => {
  const session = await signIn();
  const projectId = randomUUID();
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [
    projectId,
    'Agent credentials',
  ]);
  await post(
    `/admin/users/${userId}/projects/${projectId}`,
    { active: true, roles: ['OWNER'] },
    session,
  );
  const response = await post(
    '/admin/agents',
    {
      label: 'Synthetic automated client',
      projectId,
      scopes: ['task:read', 'task:write'],
      audiences: ['api', 'mcp'],
      expiresInDays: 1,
    },
    session,
  );
  assert.equal(response.status, 201);
  const credential = (await response.json()).data;
  const list = await (await get('/admin/agents', session)).json();
  assert.equal(JSON.stringify(list).includes(credential.token), false);
  assert.equal(JSON.stringify(list).includes('token_hash'), false);
  const store = new CoordinationStore(pool);
  const owner = { projectId, principalId: userId };
  const task = await store.createTask(owner, randomUUID(), {
    title: 'Agent claim invalidation',
    criteria: [{ id: 'c', description: 'Observed', required: true }],
  });
  const ready = await store.transitionTask(owner, randomUUID(), task.id, {
    expectedVersion: task.version,
    to: 'READY',
  });
  const agentPost = (path: string, body: unknown) =>
    fetch(`${origin}/api/v1/projects/${projectId}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential.token}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify(body),
    });
  const logical = await agentPost('/agent-sessions', {});
  assert.equal(logical.status, 201);
  const logicalId = (await logical.json()).data.id;
  assert.equal(
    (
      await agentPost(`/tasks/${task.id}/claim`, {
        sessionId: logicalId,
        expectedVersion: ready.version,
      })
    ).status,
    201,
  );
  const revoke = await post(`/admin/agents/${credential.id}/revoke`, {}, session);
  assert.equal(revoke.status, 201);
  assert.equal(
    (
      await fetch(`${origin}/api/v1/projects`, {
        headers: { authorization: `Bearer ${credential.token}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (await pool.query('SELECT revoked FROM task_claims WHERE task_id=$1', [task.id])).rows[0]
      .revoked,
    true,
  );
  assert.equal(
    (
      await pool.query('SELECT ended_at IS NOT NULL AS ended FROM agent_sessions WHERE id=$1', [
        logicalId,
      ])
    ).rows[0].ended,
    true,
  );
  assert.equal(
    JSON.stringify(
      (await pool.query('SELECT payload FROM audit_events WHERE project_id=$1', [projectId])).rows,
    ).includes(credential.token),
    false,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/v1/projects`, {
        headers: {
          authorization: `Bearer acc_${'-'.repeat(36)}.${'x'.repeat(43)}`,
          cookie: session.cookie,
        },
      })
    ).status,
    401,
  );
});

test('intentos fallidos se limitan en PostgreSQL sin revelar si existe el usuario', async () => {
  const session = await start();
  const username = `unknown-${randomUUID().slice(0, 8)}`;
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await post('/auth/login', { username, password: 'wrong-password' }, session)).status,
      401,
    );
  const denied = await post('/auth/login', { username, password: 'wrong-password' }, session);
  assert.equal(denied.status, 429);
  assert.equal((await denied.json()).error.code, 'LOGIN_THROTTLED');
});
