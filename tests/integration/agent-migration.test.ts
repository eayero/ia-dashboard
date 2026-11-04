import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Pool } from '../../packages/db/src/index.ts';

async function legacyFixture(ambiguous = false) {
  const schema = `acc_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  const directory = new URL('../../packages/db/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => /^00[1-6]_/.test(file)).sort())
    await pool.query(await readFile(new URL(file, directory), 'utf8'));
  const ownerId = randomUUID(),
    agentId = randomUUID(),
    projectId = randomUUID(),
    credentialId = randomUUID();
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN'),($2,'AGENT')", [
    ownerId,
    agentId,
  ]);
  await pool.query(
    "INSERT INTO local_users(principal_id,username,display_name,password_hash) VALUES ($1,'migration-owner','Synthetic owner','synthetic-no-login')",
    [ownerId],
  );
  await pool.query("INSERT INTO projects(id,name) VALUES ($1,'Legacy ownership')", [projectId]);
  await pool.query(
    "INSERT INTO project_members(project_id,principal_id,roles,scopes) VALUES ($1,$2,ARRAY['OWNER'],'{}'),($1,$3,'{}',ARRAY['task:read','task:write'])",
    [projectId, ownerId, agentId],
  );
  await pool.query(
    "INSERT INTO agent_credentials(id,principal_id,label,token_hash,scopes,audiences,expires_at,revoked_at) VALUES ($1,$2,'legacy-agent:mcp',$3,ARRAY['task:read'],ARRAY['mcp'],clock_timestamp()+interval '1 day',clock_timestamp())",
    [credentialId, agentId, Buffer.alloc(32, 7)],
  );
  await pool.query(
    "INSERT INTO audit_events(id,project_id,seq,actor_id,entity_id,entity_type,action,payload,trace_id) VALUES ($1,$2,1,$3,$3,'PRINCIPAL','legacy.action','{}',$4)",
    [randomUUID(), projectId, agentId, randomUUID()],
  );
  if (ambiguous) {
    const other = randomUUID();
    await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [other]);
    await pool.query(
      "INSERT INTO local_users(principal_id,username,display_name,password_hash) VALUES ($1,'second-owner','Second owner','synthetic-no-login')",
      [other],
    );
    await pool.query(
      "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER'])",
      [projectId, other],
    );
  }
  const sql = await readFile(new URL('007_agent_ownership.sql', directory), 'utf8');
  return {
    pool,
    ownerId,
    agentId,
    projectId,
    credentialId,
    sql,
    cleanup: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

test('migración de agentes conserva IDs, hashes/revocaciones y no reescribe atribución histórica', async () => {
  const f = await legacyFixture();
  try {
    const fingerprint = async () =>
      createHash('sha256')
        .update(
          JSON.stringify((await f.pool.query('SELECT * FROM agent_credentials ORDER BY id')).rows),
        )
        .digest('hex');
    const before = await fingerprint();
    await f.pool.query('BEGIN');
    await f.pool.query(f.sql);
    await f.pool.query('COMMIT');
    assert.equal(await fingerprint(), before);
    const agent = (
      await f.pool.query('SELECT * FROM agent_profiles WHERE principal_id=$1', [f.agentId])
    ).rows[0];
    assert.equal(agent.owner_user_id, f.ownerId);
    assert.equal(agent.name, 'legacy-agent');
    assert.equal(
      (await f.pool.query('SELECT actor_user_id FROM audit_events WHERE seq=1')).rows[0]
        .actor_user_id,
      null,
    );
    await f.pool.query(
      "INSERT INTO audit_events(id,project_id,seq,actor_id,actor_user_id,entity_id,entity_type,action,payload,trace_id) VALUES ($1,$2,2,$3,NULL,$3,'PRINCIPAL','new.action','{}',$4)",
      [randomUUID(), f.projectId, f.agentId, randomUUID()],
    );
    assert.equal(
      (await f.pool.query('SELECT actor_user_id FROM audit_events WHERE seq=2')).rows[0]
        .actor_user_id,
      f.ownerId,
    );
  } finally {
    await f.cleanup();
  }
});
test('migración rechaza propietarios ambiguos y revierte todo sin inventar asociaciones', async () => {
  const f = await legacyFixture(true);
  try {
    await f.pool.query('BEGIN');
    await assert.rejects(f.pool.query(f.sql), /ownership is ambiguous/);
    await f.pool.query('ROLLBACK');
    assert.equal(
      (await f.pool.query("SELECT to_regclass(current_schema()||'.agent_profiles') AS relation"))
        .rows[0].relation,
      null,
    );
    assert.equal(
      (await f.pool.query('SELECT count(*)::int AS count FROM agent_credentials')).rows[0].count,
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test('creador auditado resuelve la propiedad aunque un proyecto tenga varios propietarios', async () => {
  const f = await legacyFixture(true);
  try {
    await f.pool.query(
      "INSERT INTO security_events(id,actor_id,target_id,action) VALUES ($1,$2,$3,'credential.created')",
      [randomUUID(), f.ownerId, f.agentId],
    );
    await f.pool.query('BEGIN');
    await f.pool.query(f.sql);
    await f.pool.query('COMMIT');
    assert.equal(
      (
        await f.pool.query('SELECT owner_user_id FROM agent_profiles WHERE principal_id=$1', [
          f.agentId,
        ])
      ).rows[0].owner_user_id,
      f.ownerId,
    );
  } finally {
    await f.cleanup();
  }
});
