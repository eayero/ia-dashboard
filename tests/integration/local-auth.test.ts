import { withTaskRequirement } from '../../apps/api/test/task-requirement-fixture.ts';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Pool } from '../../packages/db/src/index.ts';
import { FixtureCoordinationStore as CoordinationStore } from '../../apps/api/test/task-requirement-fixture.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { createApplication } from '../../apps/api/src/app.ts';
import { loadConfiguration } from '../../apps/api/src/config.ts';
import { hashPassword } from '../../apps/api/src/auth/password.ts';
import { Client, StreamableHTTPClientTransport } from '../../apps/api/test/mcp-client.ts';
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
  const project = /\/projects\/([^/]+)\/tasks$/.exec(path)?.[1];
  if (project && body && typeof body === 'object' && 'criteria' in body)
    body = await withTaskRequirement(pool, project, body);
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
test('un usuario tiene agentes propios con una identidad y credencial para varios proyectos', async () => {
  const adminSession = await signIn();
  const user = await createUser(adminSession);
  const projectIds = [randomUUID(), randomUUID()];
  for (const id of projectIds) {
    await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [id, 'Owned agent project']);
    assert.equal(
      (
        await post(
          `/admin/users/${user.id}/projects/${id}`,
          { active: true, roles: ['OWNER'] },
          adminSession,
        )
      ).status,
      201,
    );
  }
  const temporary = await signIn(user.username);
  const changed = await post(
    '/auth/password',
    { currentPassword: password, newPassword: `${password}-owner` },
    temporary,
  );
  assert.equal(changed.status, 201);
  const owner = { cookie: cookie(changed), csrf: (await changed.json()).data.csrfToken as string };
  const response = await post(
    '/agents',
    {
      label: 'Owned multi-project agent',
      projectIds,
      scopes: ['task:read', 'task:write'],
      audiences: ['api', 'mcp'],
      expiresInDays: 1,
    },
    owner,
  );
  assert.equal(response.status, 201);
  const credential = (await response.json()).data;
  assert.equal(credential.ownerUserId, user.id);
  const ownList = await get('/agents', owner);
  assert.equal(ownList.status, 200);
  const identities = (await ownList.json()).data;
  assert.equal(identities.length, 1);
  assert.equal(identities[0].id, credential.principalId);
  assert.deepEqual(
    identities[0].projects.map((p: { id: string }) => p.id).sort(),
    projectIds.sort(),
  );
  assert.equal(JSON.stringify(identities).includes(credential.token), false);
  assert.equal(JSON.stringify(identities).includes('token_hash'), false);
  const projects = await fetch(`${origin}/api/v1/projects`, {
    headers: { authorization: `Bearer ${credential.token}` },
  });
  assert.equal(projects.status, 200);
  assert.deepEqual(
    (await projects.json()).data.map((p: { id: string }) => p.id).sort(),
    projectIds.sort(),
  );
  const me = await fetch(`${origin}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${credential.token}` },
  });
  assert.equal((await me.json()).data.principal.ownerUserId, user.id);
  const extra = await post(
    `/agents/${credential.principalId}/credentials`,
    {
      label: 'Second credential same agent',
      scopes: ['task:read'],
      audiences: ['mcp'],
      expiresInDays: 1,
    },
    owner,
  );
  assert.equal(extra.status, 201);
  assert.equal((await extra.json()).data.principalId, credential.principalId);
  const users = (await (await get('/admin/users', adminSession)).json()).data.users;
  assert.equal(
    users.find((u: { id: string }) => u.id === user.id).agents[0].id,
    credential.principalId,
  );
  const client = new Client({ name: 'owned-agent-projects', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${credential.token}` } },
      }),
    );
    const listed = await client.callTool({ name: 'acc_list_projects', arguments: {} });
    assert.equal(listed.isError, undefined);
    assert.deepEqual(
      (listed.structuredContent as { data: { id: string }[] }).data.map((p) => p.id).sort(),
      projectIds.sort(),
    );
    for (const id of projectIds) {
      const created = await client.callTool({
        name: 'acc_find_or_create_task',
        arguments: {
          projectId: id,
          idempotencyKey: randomUUID(),
          input: {
            ...(await withTaskRequirement(pool, id, { title: 'Owned agent attribution' })),
            title: 'Owned agent attribution',
            criteria: [{ id: 'c', description: 'Owner is auditable', required: true }],
          },
        },
      });
      assert.notEqual(created.isError, true);
      const audit = (
        await pool.query('SELECT actor_id,actor_user_id FROM audit_events WHERE entity_id=$1', [
          (created.structuredContent as { data: { id: string } }).data.id,
        ])
      ).rows[0];
      assert.equal(audit.actor_id, credential.principalId);
      assert.equal(audit.actor_user_id, user.id);
    }
  } finally {
    await client.close();
  }
  const another = await createUser(adminSession);
  const anotherTemporary = await signIn(another.username);
  const anotherChange = await post(
    '/auth/password',
    { currentPassword: password, newPassword: `${password}-another` },
    anotherTemporary,
  );
  const anotherSession = {
    cookie: cookie(anotherChange),
    csrf: (await anotherChange.json()).data.csrfToken as string,
  };
  assert.equal((await (await get('/agents', anotherSession)).json()).data.length, 0);
  assert.equal(
    (
      await post(
        `/agents/${credential.principalId}/credentials`,
        { label: 'Denied', scopes: ['task:read'], audiences: ['mcp'] },
        anotherSession,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        `/agents/${credential.principalId}/projects/${projectIds[0]}`,
        { active: false, scopes: ['task:read'], expectedVersion: 1 },
        anotherSession,
      )
    ).status,
    403,
  );
  const unrelated = randomUUID();
  await pool.query("INSERT INTO projects(id,name) VALUES ($1,'Unrelated project')", [unrelated]);
  assert.equal(
    (
      await post(
        `/agents/${credential.principalId}/projects/${unrelated}`,
        { active: false, scopes: ['task:read'], expectedVersion: 0 },
        owner,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(
        '/agents',
        {
          label: 'Forged owner',
          ownerUserId: user.id,
          projectIds,
          scopes: ['task:read'],
          audiences: ['mcp'],
        },
        anotherSession,
      )
    ).status,
    403,
  );
  for (const id of projectIds)
    assert.equal(
      (
        await post(
          `/admin/users/${userId}/projects/${id}`,
          { active: true, roles: ['OWNER'] },
          adminSession,
        )
      ).status,
      201,
    );
  const store = new CoordinationStore(pool);
  const logical = await store.registerSession(
    { projectId: projectIds[0]!, principalId: credential.principalId },
    randomUUID(),
    {},
  );
  assert.equal(
    (
      await post(
        `/admin/users/${user.id}/projects/${projectIds[0]}`,
        { active: false, roles: ['OWNER'], expectedVersion: 1 },
        adminSession,
      )
    ).status,
    201,
  );
  const afterRemoval = await fetch(`${origin}/api/v1/projects`, {
    headers: { authorization: `Bearer ${credential.token}` },
  });
  assert.deepEqual(
    (await afterRemoval.json()).data.map((p: { id: string }) => p.id),
    [projectIds[1]],
  );
  assert.equal(
    (
      await fetch(`${origin}/api/v1/projects/${projectIds[0]}/tasks`, {
        headers: { authorization: `Bearer ${credential.token}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await pool.query('SELECT ended_at IS NOT NULL AS ended FROM agent_sessions WHERE id=$1', [
        logical.id,
      ])
    ).rows[0].ended,
    true,
  );
  assert.equal(
    (
      await post(
        `/admin/users/${user.id}/projects/${projectIds[0]}`,
        { active: true, roles: ['VIEWER'], expectedVersion: 2 },
        adminSession,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await post(
        '/agents',
        {
          label: 'Cannot exceed viewer',
          projectIds: [projectIds[0]],
          scopes: ['task:read', 'task:write'],
          audiences: ['mcp'],
        },
        owner,
      )
    ).status,
    403,
  );
  const agentContext = { projectId: projectIds[1]!, principalId: credential.principalId };
  const work = await store.createTask(agentContext, randomUUID(), {
    title: 'Owner disabling revokes claim',
    criteria: [{ id: 'c', description: 'Claim revoked', required: true }],
  });
  const ready = await store.transitionTask(agentContext, randomUUID(), work.id, {
    expectedVersion: work.version,
    to: 'READY',
  });
  const activeSession = await store.registerSession(agentContext, randomUUID(), {});
  await store.claimTask(agentContext, randomUUID(), work.id, {
    expectedVersion: ready.version,
    sessionId: activeSession.id,
  });
  assert.equal(
    (await post(`/admin/users/${user.id}/status`, { disabled: true }, adminSession)).status,
    201,
  );
  assert.equal(
    (await pool.query('SELECT revoked FROM task_claims WHERE task_id=$1', [work.id])).rows[0]
      .revoked,
    true,
  );
  assert.equal(
    (
      await pool.query('SELECT ended_at IS NOT NULL AS ended FROM agent_sessions WHERE id=$1', [
        activeSession.id,
      ])
    ).rows[0].ended,
    true,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/v1/projects`, {
        headers: { authorization: `Bearer ${credential.token}` },
      })
    ).status,
    401,
  );
});
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
