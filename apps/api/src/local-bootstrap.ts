import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { Pool } from '@acc/db';
import { z } from 'zod';
import { loadConfiguration } from './config.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { provisionLocalAgents } from './local-agents.ts';

export async function bootstrapLocal(env: Record<string, string | undefined>, pool: pg.Pool) {
  const config = loadConfiguration(env);
  const issuer = new URL(config.issuer);
  const db = new URL(config.databaseUrl);
  if (
    config.nodeEnv !== 'development' ||
    ![issuer.hostname, db.hostname, new URL(config.publicOrigin).hostname].every((host) =>
      ['localhost', '127.0.0.1', '[::1]'].includes(host),
    )
  )
    throw new Error('Bootstrap is restricted to local development');
  const realm = /^\/realms\/([a-zA-Z0-9_-]+)$/u.exec(issuer.pathname)?.[1];
  if (!realm || !env.KEYCLOAK_ADMIN || !env.KEYCLOAK_ADMIN_PASSWORD)
    throw new Error('Local Keycloak administrator configuration is required');
  const tokenResponse = await fetch(
    `${issuer.origin}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: env.KEYCLOAK_ADMIN,
        password: env.KEYCLOAK_ADMIN_PASSWORD,
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!tokenResponse.ok) throw new Error('Local Keycloak administrator authentication failed');
  const token = z.object({ access_token: z.string() }).parse(await tokenResponse.json());
  const usersResponse = await fetch(
    `${issuer.origin}/admin/realms/${realm}/users?username=owner&exact=true`,
    {
      headers: { authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!usersResponse.ok) throw new Error('Local Keycloak user lookup failed');
  const users = z
    .array(z.object({ id: z.uuid(), username: z.literal('owner') }))
    .length(1)
    .parse(await usersResponse.json());
  const subject = users[0]!.id;
  const projectId = '3268b4d2-cd9d-4afc-bc76-ea631997cd73';
  let principalId: string;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('acc:local-bootstrap',0))");
    const existing = await client.query<{ principal_id: string; kind: string }>(
      'SELECT principal_id,kind FROM oidc_identities WHERE issuer=$1 AND subject=$2',
      [config.issuer, subject],
    );
    principalId = existing.rows[0]?.principal_id ?? randomUUID();
    if (existing.rows[0] && existing.rows[0].kind !== 'HUMAN')
      throw new Error('Existing identity is not human');
    if (!existing.rowCount) {
      await client.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN')", [principalId]);
      await client.query(
        "INSERT INTO oidc_identities(issuer,subject,principal_id,kind) VALUES ($1,$2,$3,'HUMAN')",
        [config.issuer, subject, principalId],
      );
    }
    await client.query('INSERT INTO projects(id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
      projectId,
      'ACC · Demostración local',
    ]);
    await client.query(
      "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER']) ON CONFLICT DO NOTHING",
      [projectId, principalId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const agents = await provisionLocalAgents(
    config.issuer,
    realm,
    token.access_token,
    pool,
    projectId,
    `${config.publicOrigin}/mcp`,
  );
  return { projectId, principalId, agents };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const config = loadConfiguration(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const result = await bootstrapLocal(process.env, pool);
    await mkdir('.cache', { recursive: true });
    await writeFile(
      '.cache/local-agents.json',
      JSON.stringify(
        { issuer: config.issuer, projectId: result.projectId, agents: result.agents },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      'Local owner, two service accounts and demo project provisioned. Credentials in .cache/local-agents.json. Existing permissions were preserved.',
    );
  } catch {
    console.error('Local bootstrap failed. Check local configuration and migrations.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
