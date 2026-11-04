import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from '../../packages/db/src/index.ts';
import { migrate } from '../../packages/db/src/migrate.ts';
import { bootstrapLocal } from '../../apps/api/src/local-bootstrap.ts';
import { hashPassword } from '../../apps/api/src/auth/password.ts';

const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const options = { username: 'bootstrap-owner', password: 'synthetic bootstrap password' };

before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrate(pool);
});
after(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

// Compare private state without putting password/token hashes in assertion output.
async function fingerprint() {
  const hash = createHash('sha256');
  for (const table of [
    'projects',
    'principals',
    'local_users',
    'project_members',
    'agent_credentials',
  ]) {
    const rows = await pool.query(
      `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
    );
    hash.update(JSON.stringify(rows.rows));
  }
  return hash.digest('hex');
}

test('bootstrap conserva identidad, contraseña cambiada, permisos retirados y credenciales revocadas o expiradas', async () => {
  const initial = await bootstrapLocal(process.env, pool, { ...options, cachedAgents: [] });
  assert.equal(initial.agents.length, 2);
  const owner = initial.principalId;
  const agent = initial.agents[0]!;
  await pool.query(
    "UPDATE local_users SET password_hash=$1,credential_version=credential_version+1,must_change_password=true,system_role='USER' WHERE principal_id=$2",
    [await hashPassword('a changed synthetic bootstrap password'), owner],
  );
  await pool.query('UPDATE principals SET disabled=true WHERE id=$1', [owner]);
  await pool.query(
    "UPDATE project_members SET active=false,roles=ARRAY['VIEWER'],scopes=ARRAY[]::text[],version=version+1 WHERE project_id=$1",
    [initial.projectId],
  );
  await pool.query(
    'UPDATE agent_credentials SET revoked_at=clock_timestamp() WHERE principal_id=$1',
    [agent.principalId],
  );
  await pool.query(
    "UPDATE agent_credentials SET expires_at=clock_timestamp()-interval '1 day' WHERE principal_id=$1",
    [initial.agents[1]!.principalId],
  );
  const before = await fingerprint();
  const repeated = await Promise.all([
    bootstrapLocal(process.env, pool, { ...options, cachedAgents: initial.agents }),
    bootstrapLocal(process.env, pool, { ...options, cachedAgents: initial.agents }),
  ]);
  for (const result of repeated) {
    assert.equal(result.principalId, owner);
    assert.equal(result.projectId, initial.projectId);
    assert.equal(
      createHash('sha256').update(JSON.stringify(result.agents)).digest('hex'),
      createHash('sha256').update(JSON.stringify(initial.agents)).digest('hex'),
    );
  }
  assert.equal(await fingerprint(), before);
});

test('bootstrap sin secretos existentes falla sin emitir credenciales ni cambiar datos', async () => {
  const before = await fingerprint();
  await assert.rejects(
    bootstrapLocal(process.env, pool, { ...options, cachedAgents: [] }),
    /Existing local credential cannot be recovered/,
  );
  assert.equal(await fingerprint(), before);
});

test('bootstrap rechaza producción y orígenes remotos antes de escribir', async () => {
  const before = await fingerprint();
  for (const override of [{ NODE_ENV: 'production' }, { PUBLIC_ORIGIN: 'https://example.test' }]) {
    await assert.rejects(bootstrapLocal({ ...process.env, ...override }, pool, options));
  }
  assert.equal(await fingerprint(), before);
});
