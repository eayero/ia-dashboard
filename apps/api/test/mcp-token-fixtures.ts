import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { issueCredential } from '../src/auth/credentials.ts';
import { seedAgentOwner } from './agent-owner-fixture.ts';
export async function mcpTokenFixture(pool: pg.Pool, audiences: string[], scopes: string[]) {
  const principalId = randomUUID();
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'AGENT')", [principalId]);
  const owner = (
    await pool.query<{ principal_id: string }>(
      'SELECT principal_id FROM local_users ORDER BY created_at,principal_id LIMIT 1',
    )
  ).rows[0]!;
  await seedAgentOwner(pool, principalId, owner.principal_id);
  return issueCredential(pool, principalId, 'Synthetic read-only credential', scopes, audiences);
}
