import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { issueCredential } from '../src/auth/credentials.ts';
export async function mcpTokenFixture(pool: pg.Pool, audiences: string[], scopes: string[]) {
  const principalId = randomUUID();
  await pool.query("INSERT INTO principals(id,kind) VALUES ($1,'AGENT')", [principalId]);
  return issueCredential(pool, principalId, 'Synthetic read-only credential', scopes, audiences);
}
