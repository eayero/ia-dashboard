import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { issueCredential, tokenMatches } from './credentials.ts';

export type LocalAgent = {
  label?: string;
  clientId?: string;
  principalId: string;
  apiToken?: string;
  mcpToken?: string;
};
export async function provisionAgents(
  db: pg.PoolClient,
  projectId: string,
  ownerUserId: string,
  cached: LocalAgent[] = [],
) {
  const agents: { label: string; principalId: string; apiToken: string; mcpToken: string }[] = [];
  for (const label of ['acc-local-agent-a', 'acc-local-agent-b']) {
    const previous = cached.find((agent) => (agent.label ?? agent.clientId) === label);
    const existing = (
      await db.query<{ principal_id: string }>(
        'SELECT principal_id FROM agent_credentials WHERE label=$1 LIMIT 1',
        [`${label}:api`],
      )
    ).rows[0];
    const legacy = previous
      ? (
          await db.query("SELECT id FROM principals WHERE id=$1 AND kind='AGENT'", [
            previous.principalId,
          ])
        ).rows[0]
      : undefined;
    const principalId: string = existing?.principal_id ?? legacy?.id ?? randomUUID();
    await db.query("INSERT INTO principals(id,kind) VALUES ($1,'AGENT') ON CONFLICT DO NOTHING", [
      principalId,
    ]);
    await db.query(
      'INSERT INTO agent_profiles(principal_id,owner_user_id,name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [principalId, ownerUserId, label],
    );
    await db.query(
      "INSERT INTO project_members(project_id,principal_id,scopes) VALUES ($1,$2,ARRAY['task:read','task:write']) ON CONFLICT DO NOTHING",
      [projectId, principalId],
    );
    async function token(audience: 'api' | 'mcp', value?: string) {
      const found = (
        await db.query<{ token_hash: Buffer }>(
          'SELECT token_hash FROM agent_credentials WHERE principal_id=$1 AND label=$2 LIMIT 1',
          [principalId, `${label}:${audience}`],
        )
      ).rows[0];
      if (found) {
        if (!value || !tokenMatches(value, found.token_hash))
          throw new Error(
            'Existing local credential cannot be recovered; use account administration',
          );
        return value; // Never renew, rotate or un-revoke implicitly.
      }
      return (
        await issueCredential(
          db,
          principalId,
          `${label}:${audience}`,
          ['task:read', 'task:write'],
          [audience],
          30,
        )
      ).token;
    }
    agents.push({
      label,
      principalId,
      apiToken: await token('api', previous?.apiToken),
      mcpToken: await token('mcp', previous?.mcpToken),
    });
  }
  return agents;
}
