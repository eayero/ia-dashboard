import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import { Pool } from '@acc/db';
import { usernameSchema, passwordSchema } from '@acc/contracts';
import { loadConfiguration } from './config.ts';
import { hashPassword } from './auth/password.ts';
import { provisionAgents, type LocalAgent } from './auth/local-agents.ts';

type BootstrapOptions = { username?: string; password?: string; cachedAgents?: LocalAgent[] };
export async function bootstrapLocal(
  env: Record<string, string | undefined>,
  pool: pg.Pool,
  options: BootstrapOptions = {},
) {
  const config = loadConfiguration(env);
  const dbHost = new URL(config.databaseUrl).hostname;
  const localHosts = ['localhost', '127.0.0.1', '[::1]'];
  if (
    config.nodeEnv !== 'development' ||
    !localHosts.includes(new URL(config.publicOrigin).hostname) ||
    !(
      localHosts.includes(dbHost) ||
      (env.ACC_LOCAL_DOCKER_BOOTSTRAP === '1' && dbHost === 'postgres')
    )
  )
    throw new Error('Bootstrap is restricted to local development');
  let initial: { username: string; password: string } = {
    username: 'owner',
    password: randomBytes(32).toString('hex'),
  };
  try {
    const local = await readFile('.cache/local-login.txt', 'utf8');
    const username = /Usuario:\s*([a-zA-Z0-9_.-]+)/u.exec(local)?.[1];
    const password = /Contraseña:\s*(\S+)/u.exec(local)?.[1];
    if (username && password) initial = { username, password };
  } catch {
    /* Fresh local installation. */
  }
  const username = usernameSchema.parse(options.username ?? initial.username);
  const password = passwordSchema.parse(options.password ?? initial.password);
  let cached = options.cachedAgents;
  if (!cached) {
    try {
      cached = JSON.parse(await readFile('.cache/local-agents.json', 'utf8')).agents;
    } catch {
      cached = [];
    }
  }
  const projectId = '3268b4d2-cd9d-4afc-bc76-ea631997cd73';
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('acc:local-bootstrap',0))");
    await db.query('INSERT INTO projects(id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
      projectId,
      'ACC · Demostración local',
    ]);
    const user = (
      await db.query<{ principal_id: string }>(
        'SELECT principal_id FROM local_users WHERE username=$1',
        [username],
      )
    ).rows[0];
    let principalId = user?.principal_id;
    if (!principalId) {
      const legacy = await db.query<{ id: string }>(
        "SELECT p.id FROM principals p JOIN project_members m ON m.principal_id=p.id WHERE m.project_id=$1 AND p.kind='HUMAN' AND 'OWNER'=ANY(m.roles) AND EXISTS(SELECT 1 FROM oidc_identities i WHERE i.principal_id=p.id)",
        [projectId],
      );
      if (legacy.rowCount! > 1)
        throw new Error('Multiple legacy owners require explicit migration');
      principalId = legacy.rows[0]?.id ?? randomUUID();
      await db.query("INSERT INTO principals(id,kind) VALUES ($1,'HUMAN') ON CONFLICT DO NOTHING", [
        principalId,
      ]);
      await db.query(
        "INSERT INTO local_users(principal_id,username,display_name,password_hash,system_role,must_change_password) VALUES ($1,$2,$3,$4,'ADMIN',false)",
        [principalId, username, 'Propietario local', await hashPassword(password)],
      );
    }
    await db.query(
      "INSERT INTO project_members(project_id,principal_id,roles) VALUES ($1,$2,ARRAY['OWNER']) ON CONFLICT DO NOTHING",
      [projectId, principalId],
    );
    const agents = await provisionAgents(db, projectId, principalId, cached);
    await db.query('COMMIT');
    return { projectId, principalId, username, password, agents };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const config = loadConfiguration(process.env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const result = await bootstrapLocal(process.env, pool);
    await mkdir('.cache', { recursive: true });
    await writeFile(
      '.cache/local-login.txt',
      `Solo desarrollo local. Usuario: ${result.username}\nContraseña: ${result.password}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      '.cache/local-agents.json',
      JSON.stringify({ projectId: result.projectId, agents: result.agents }, null, 2),
      { mode: 0o600 },
    );
    console.log(
      'Local ACC owner and agent credentials provisioned. Initial credentials in ignored .cache files. Existing passwords, permissions and revocations were preserved.',
    );
  } catch {
    console.error('Local ACC bootstrap failed. Check migrations and local credential files.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
