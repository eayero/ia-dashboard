import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Pool, OutboxStore } from '../../packages/db/src/index.ts';
import { FixtureCoordinationStore as CoordinationStore } from '../../apps/api/test/task-requirement-fixture.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { createApplication } from '../../apps/api/src/app.ts';
import { loadConfiguration } from '../../apps/api/src/config.ts';
import { hashPassword } from '../../apps/api/src/auth/password.ts';
import { io, type Socket } from '../../apps/web/test/realtime-client.ts';
import { RedisEventSink } from '../../apps/api/src/outbox/redis.ts';
import { OutboxWorker } from '../../apps/api/src/outbox/worker.ts';
import { redisInspector } from '../../apps/api/test/redis-fixtures.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const config = loadConfiguration(process.env);
const userId = randomUUID(),
  projectId = randomUUID();
const password = 'Synthetic realtime password 12345';
let app: Awaited<ReturnType<typeof createApplication>>;
let origin: string;
const sockets: Socket[] = [];
const redis = redisInspector(process.env.REDIS_URL!);
const otherProjectId = randomUUID();
before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [userId]);
  await pool.query(
    "INSERT INTO local_users(principal_id,username,display_name,password_hash,system_role,must_change_password) VALUES ($1,'realtime-user','Synthetic realtime',$2,'ADMIN',false)",
    [userId, await hashPassword(password)],
  );
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [
    projectId,
    'Realtime synthetic',
  ]);
  await pool.query('INSERT INTO projects(id,name) VALUES ($1,$2)', [
    otherProjectId,
    'Foreign realtime synthetic',
  ]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
    [projectId, userId],
  );
  app = await createApplication(config, pool);
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  await redis.connect();
});
after(async () => {
  sockets.forEach((s) => s.disconnect());
  if (app) await app.close();
  if (redis.isOpen) {
    await redis.del(`acc:events:${projectId}`);
    redis.destroy();
  }
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
function cookie(r: Response) {
  return (
    r.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .find((v) => v?.startsWith('acc.sid=')) ?? ''
  );
}
async function signIn() {
  const initial = await fetch(origin + '/api/v1/auth/session');
  const csrf = (await initial.json()).data.csrfToken;
  const r = await fetch(origin + '/api/v1/auth/login', {
    method: 'POST',
    headers: {
      origin: config.publicOrigin,
      cookie: cookie(initial),
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ username: 'realtime-user', password }),
  });
  assert.equal(r.status, 201);
  return { cookie: cookie(r), csrf: (await r.json()).data.csrfToken };
}
async function connect(
  headers: Record<string, string>,
  id: string = projectId,
  serverOrigin = origin,
) {
  const socket = io(serverOrigin, {
    path: '/ws/v1',
    transports: ['websocket'],
    auth: { projectId: id },
    extraHeaders: { origin: config.publicOrigin, ...headers },
    reconnection: false,
    autoConnect: false,
    timeout: 2000,
  });
  sockets.push(socket);
  const result = await new Promise<{
    ready?: { projectId: string; principalId: string };
    error?: string;
    status?: number;
  }>((resolve) => {
    const timer = setTimeout(() => resolve({ error: 'TIMEOUT' }), 3000);
    socket.once('acc:ready', (ready) => {
      clearTimeout(timer);
      resolve({ ready });
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      resolve({
        error: error.message,
        status: (error as Error & { data?: { status: number } }).data?.status,
      });
    });
    socket.connect();
  });
  return { socket, ...result };
}
test('WS autoriza la cookie humana y confirma solo el proyecto solicitado', async () => {
  const session = await signIn();
  const result = await connect({ cookie: session.cookie });
  assert.ok(result.ready, `WS debe autorizar la conexión: ${result.error}`);
  assert.equal(result.ready.projectId, projectId);
  assert.equal(result.ready.principalId, userId);
  result.socket.disconnect();
});

function event<T>(socket: Socket, name: string, predicate: (value: T) => boolean = () => true) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, receive);
      reject(new Error('Expected ' + name));
    }, 5000);
    const receive = (value: T) => {
      if (predicate(value)) {
        clearTimeout(timer);
        socket.off(name, receive);
        resolve(value);
      }
    };
    socket.on(name, receive);
  });
}
async function createAndPublish(title: string) {
  const task = await new CoordinationStore(pool).createTask(
    { projectId, principalId: userId },
    randomUUID(),
    { title, criteria: [{ id: 'a', description: 'Synthetic event', required: true }] },
  );
  const sink = new RedisEventSink(process.env.REDIS_URL!);
  const worker = new OutboxWorker(new OutboxStore(pool), sink);
  try {
    while ((await worker.processOne()) !== 'idle') {
      /* Drain only this isolated schema. */
    }
  } finally {
    sink.close();
  }
  return task;
}
test('WS rechaza anónimos, Origin ajeno, UUID inválido y proyecto ajeno', async () => {
  const session = await signIn();
  assert.equal((await connect({})).status, 401);
  assert.ok((await connect({ cookie: session.cookie, origin: 'https://foreign.invalid' })).error);
  assert.equal((await connect({ cookie: session.cookie }, 'bad-project')).status, 400);
  assert.equal((await connect({ cookie: session.cookie }, otherProjectId)).status, 403);
});
test('WS entrega el envelope del outbox real y la reconexión recupera cambios por delta', async () => {
  const session = await signIn();
  const first = await connect({ cookie: session.cookie });
  assert.ok(first.ready);
  const snapshot = await fetch(origin + `/api/v1/projects/${projectId}/context?limit=100`, {
    headers: { cookie: session.cookie },
  });
  const cursor = (await snapshot.json()).data.changesCursor;
  assert.ok(cursor);
  const delivered = event<{
    type: string;
    projectId: string;
    actorId: string;
    actorUserId: string;
    seq: string;
    payload: Record<string, unknown>;
  }>(first.socket, 'acc:event', (e) => e.type === 'task.created');
  await createAndPublish('Realtime event delivered');
  const received = await delivered;
  assert.equal(received.projectId, projectId);
  assert.equal(received.actorId, userId);
  assert.equal(received.actorUserId, userId);
  assert.match(received.seq, /^[0-9]+$/);
  assert.equal('fencingToken' in received.payload, false);
  first.socket.disconnect();
  await redis.del(`acc:events:${projectId}`);
  await createAndPublish('Created during disconnection');
  const second = await connect({ cookie: session.cookie });
  assert.ok(second.ready);
  const changes = await fetch(
    origin + `/api/v1/projects/${projectId}/events?cursor=${encodeURIComponent(cursor)}`,
    { headers: { cookie: session.cookie } },
  );
  assert.equal(changes.status, 200);
  const delta = (await changes.json()).data;
  assert.equal(delta.events.filter((e: { type: string }) => e.type === 'task.created').length, 2);
  assert.equal(delta.complete, true);
  second.socket.disconnect();
});
test('WS reautoriza una cookie abierta después de logout y no entrega eventos posteriores', async () => {
  const session = await signIn();
  const result = await connect({ cookie: session.cookie });
  assert.ok(result.ready);
  const lost = event<{ status: number }>(result.socket, 'acc:access-lost');
  let count = 0;
  result.socket.on('acc:event', () => count++);
  const response = await fetch(origin + '/api/v1/auth/logout', {
    method: 'POST',
    headers: {
      origin: config.publicOrigin,
      cookie: session.cookie,
      'content-type': 'application/json',
      'x-csrf-token': session.csrf,
    },
    body: '{}',
  });
  assert.equal(response.status, 201);
  await createAndPublish('After logout');
  assert.equal((await lost).status, 401);
  assert.equal(count, 0);
});
test('WS corta conexiones inactivas al retirar la membresía y rechaza reconexión', async () => {
  const session = await signIn();
  const result = await connect({ cookie: session.cookie });
  assert.ok(result.ready);
  const lost = event<{ status: number }>(result.socket, 'acc:access-lost');
  await pool.query(
    'UPDATE project_members SET active=false WHERE project_id=$1 AND principal_id=$2',
    [projectId, userId],
  );
  try {
    assert.equal((await lost).status, 403);
    assert.equal((await connect({ cookie: session.cookie })).status, 403);
  } finally {
    await pool.query(
      'UPDATE project_members SET active=true WHERE project_id=$1 AND principal_id=$2',
      [projectId, userId],
    );
  }
});
test('WS bearer mantiene audiencia/scopes y se invalida al revocar su credencial', async () => {
  const session = await signIn();
  const response = await fetch(origin + '/api/v1/agents', {
    method: 'POST',
    headers: {
      origin: config.publicOrigin,
      cookie: session.cookie,
      'content-type': 'application/json',
      'x-csrf-token': session.csrf,
    },
    body: JSON.stringify({
      label: 'Synthetic realtime agent',
      projectIds: [projectId],
      scopes: ['task:read'],
      audiences: ['api'],
      expiresInDays: 1,
    }),
  });
  assert.equal(response.status, 201);
  const credential = (await response.json()).data;
  const result = await connect({ authorization: 'Bearer ' + credential.token });
  assert.ok(result.ready);
  assert.equal(result.ready.principalId, credential.principalId);
  const lost = event<{ status: number }>(result.socket, 'acc:access-lost');
  await pool.query('UPDATE agent_credentials SET revoked_at=clock_timestamp() WHERE id=$1', [
    credential.id,
  ]);
  assert.equal((await lost).status, 401);
  assert.equal((await connect({ authorization: 'Bearer ' + credential.token })).status, 401);
});

test('WS invalida sesiones abiertas por reset, caducidad y cambio obligatorio', async () => {
  for (const cause of ['reset', 'expiry', 'temporary']) {
    const session = await signIn();
    const result = await connect({ cookie: session.cookie });
    assert.ok(result.ready);
    const lost = event<{ status: number }>(result.socket, 'acc:access-lost');
    if (cause === 'reset')
      await pool.query(
        'UPDATE local_users SET credential_version=credential_version+1 WHERE principal_id=$1',
        [userId],
      );
    if (cause === 'expiry')
      await pool.query(
        "UPDATE http_sessions SET sess=jsonb_set(sess::jsonb,'{identity,expiresAt}','0'::jsonb) WHERE sess::jsonb->'identity'->>'principalId'=$1",
        [userId],
      );
    if (cause === 'temporary')
      await pool.query('UPDATE local_users SET must_change_password=true WHERE principal_id=$1', [
        userId,
      ]);
    try {
      assert.equal((await lost).status, cause === 'temporary' ? 403 : 401);
    } finally {
      if (cause === 'temporary')
        await pool.query(
          'UPDATE local_users SET must_change_password=false WHERE principal_id=$1',
          [userId],
        );
    }
  }
});

test('WS invalida agente abierto al deshabilitar su propietario y rechaza token solo MCP', async () => {
  const session = await signIn();
  async function credential(audiences: string[]) {
    const response = await fetch(origin + '/api/v1/agents', {
      method: 'POST',
      headers: {
        origin: config.publicOrigin,
        cookie: session.cookie,
        'content-type': 'application/json',
        'x-csrf-token': session.csrf,
      },
      body: JSON.stringify({
        label: 'Synthetic realtime owner check',
        projectIds: [projectId],
        scopes: ['task:read'],
        audiences,
        expiresInDays: 1,
      }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).data;
  }
  const mcp = await credential(['mcp']);
  assert.equal((await connect({ authorization: 'Bearer ' + mcp.token })).status, 401);
  const api = await credential(['api']);
  const result = await connect({ authorization: 'Bearer ' + api.token });
  assert.ok(result.ready);
  const lost = event<{ status: number }>(result.socket, 'acc:access-lost');
  await pool.query('UPDATE principals SET disabled=true WHERE id=$1', [userId]);
  try {
    assert.equal((await lost).status, 401);
    assert.equal((await connect({ authorization: 'Bearer ' + api.token })).status, 401);
  } finally {
    await pool.query('UPDATE principals SET disabled=false WHERE id=$1', [userId]);
  }
});

test('Redis inaccesible no impide suscripción autorizada ni recuperación REST', async () => {
  const session = await signIn();
  const isolated = await createApplication({ ...config, redisUrl: 'redis://127.0.0.1:1' }, pool);
  await isolated.listen(0, '127.0.0.1');
  const isolatedOrigin = `http://127.0.0.1:${(isolated.getHttpServer().address() as AddressInfo).port}`;
  try {
    const result = await connect({ cookie: session.cookie }, projectId, isolatedOrigin);
    assert.ok(result.ready);
    const response = await fetch(
      isolatedOrigin + `/api/v1/projects/${projectId}/events?afterSeq=0`,
      { headers: { cookie: session.cookie } },
    );
    assert.equal(response.status, 200);
    assert.ok((await response.json()).data.events.length > 0);
    // Leave a live socket: app.close must terminate it instead of hanging on HTTP close.
  } finally {
    await isolated.close();
  }
});
