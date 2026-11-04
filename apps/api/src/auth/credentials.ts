import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';

export function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest();
}
export function tokenMatches(token: string, digest: Buffer) {
  return digest.length === 32 && timingSafeEqual(tokenDigest(token), digest);
}
export async function issueCredential(
  db: pg.Pool | pg.PoolClient,
  principalId: string,
  label: string,
  scopes: string[],
  audiences: string[],
  expiresInDays = 1,
) {
  const id = randomUUID();
  const token = `acc_${id}.${randomBytes(32).toString('base64url')}`;
  const result = await db.query<{ expires_at: Date }>(
    'INSERT INTO agent_credentials(id,principal_id,label,token_hash,scopes,audiences,expires_at) VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp()+make_interval(days=>$7)) RETURNING expires_at',
    [id, principalId, label, tokenDigest(token), scopes, audiences, expiresInDays],
  );
  return {
    id,
    token,
    principalId,
    label,
    scopes,
    audiences,
    expiresAt: result.rows[0]!.expires_at.toISOString(),
  };
}
