import { CoordinationStore as RealStore, Pool } from '../../../packages/db/src/index.ts';

// Explicit approved scope for older synthetic scenarios. This helper is test-only;
// production callers must always supply their actual requirement IDs.
export async function withTaskRequirement(
  pool: InstanceType<typeof Pool>,
  projectId: string,
  input: unknown,
) {
  const payload = input as Record<string, unknown>;
  if ('requirementIds' in payload) return payload;
  const id = `ffffffff-ffff-4fff-8fff-${projectId.replaceAll('-', '').slice(0, 12)}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `test-scope:${projectId}`,
    ]);
    const existing = await client.query(
      'SELECT id FROM requirements WHERE project_id=$1 AND id=$2',
      [projectId, id],
    );
    if (!existing.rowCount) {
      const owner = (
        await client.query(
          "SELECT m.principal_id FROM project_members m JOIN principals p ON p.id=m.principal_id WHERE m.project_id=$1 AND p.kind='HUMAN' ORDER BY m.principal_id LIMIT 1",
          [projectId],
        )
      ).rows[0];
      if (!owner) {
        await client.query('ROLLBACK');
        return { ...payload, requirementIds: [id] };
      }
      await client.query(
        "INSERT INTO requirements(id,project_id,public_id,created_by,approved_revision) VALUES ($1,$2,'REQ-TEST',$3,1)",
        [id, projectId, owner.principal_id],
      );
      await client.query(
        "INSERT INTO requirement_revisions(project_id,requirement_id,revision,type,title,description,reason,status,created_by,approved_by,approved_at) VALUES ($1,$2,1,'NON_FUNCTIONAL','Synthetic test scope','Approved scope for isolated regression fixtures','Fixture setup','APPROVED',$3,$3,clock_timestamp())",
        [projectId, id, owner.principal_id],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { ...payload, requirementIds: [id] };
}
export class FixtureCoordinationStore extends RealStore {
  constructor(private fixturePool: InstanceType<typeof Pool>) {
    super(fixturePool);
  }
  override async createTask(
    context: Parameters<RealStore['createTask']>[0],
    key: string,
    input: unknown,
  ) {
    return super.createTask(
      context,
      key,
      await withTaskRequirement(this.fixturePool, context.projectId, input),
    );
  }
}
