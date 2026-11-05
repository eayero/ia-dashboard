import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DomainError, type Actor } from '@acc/domain';

type Repository = { id: string; name: string; url: string };
export async function registerRepository(
  client: pg.PoolClient,
  projectId: string,
  actor: Actor,
  input: { name: string; url: string },
  event: (id: string, payload: Repository) => Promise<string>,
): Promise<Repository & { projectSeq: string }> {
  if (
    actor.kind !== 'HUMAN' ||
    !actor.roles.some((role) => ['OWNER', 'ADMIN', 'MANAGER'].includes(role))
  )
    throw new DomainError('FORBIDDEN');
  // CoordinationStore holds the exclusive project graph lock for this command.
  const prior = await client.query<Repository>(
    'SELECT id,name,url FROM repositories WHERE project_id=$1 AND url=$2',
    [projectId, input.url],
  );
  if (prior.rows[0]) {
    const seq = await client.query<{ value: string }>(
      "SELECT value FROM project_counters WHERE project_id=$1 AND kind='EVENT'",
      [projectId],
    );
    return { ...prior.rows[0], projectSeq: seq.rows[0]?.value ?? '0' };
  }
  const repository = { id: randomUUID(), ...input };
  await client.query('INSERT INTO repositories(id,project_id,name,url) VALUES ($1,$2,$3,$4)', [
    repository.id,
    projectId,
    repository.name,
    repository.url,
  ]);
  const projectSeq = await event(repository.id, repository);
  return { ...repository, projectSeq };
}
