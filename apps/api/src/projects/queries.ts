import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type pg from 'pg';
import { taskQuerySchema, taskTimeQuerySchema } from '@acc/contracts';
import { readTaskWorkTime } from '@acc/db';
import { ApiError } from '../common/errors.ts';

export class ProjectQueries {
  constructor(
    private pool: pg.Pool,
    private cursorSecret: string,
  ) {}
  async listProjects(principalId: string) {
    const result = await this.pool.query<{
      id: string;
      name: string;
      archived: boolean;
      claimsPaused: boolean;
    }>(
      `SELECT p.id,p.name,p.archived,p.claims_paused AS "claimsPaused" FROM projects p JOIN project_members m ON m.project_id=p.id JOIN principals u ON u.id=m.principal_id WHERE m.principal_id=$1 AND NOT u.disabled AND m.active AND (u.kind='HUMAN' OR ('task:read'=ANY(m.scopes) AND agent_owner_project_access(u.id,p.id,false))) ORDER BY p.id`,
      [principalId],
    );
    return result.rows;
  }
  async inProject<T>(
    projectId: string,
    principalId: string,
    read: (client: pg.PoolClient) => Promise<T>,
    readOnly = true,
  ): Promise<T> {
    z.uuid().parse(projectId);
    const client = await this.pool.connect();
    try {
      await client.query(
        readOnly
          ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
          : 'BEGIN ISOLATION LEVEL REPEATABLE READ',
      );
      const access = await client.query(
        "SELECT m.project_id FROM project_members m JOIN principals p ON p.id=m.principal_id WHERE m.project_id=$1 AND m.principal_id=$2 AND NOT p.disabled AND m.active AND (p.kind='HUMAN' OR ('task:read'=ANY(m.scopes) AND agent_owner_project_access(p.id,$1,false)))",
        [projectId, principalId],
      );
      if (!access.rowCount) throw new ApiError(403, 'FORBIDDEN');
      const result = await read(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private encodeCursor(projectId: string, status: string | undefined, id: string) {
    const data = Buffer.from(JSON.stringify({ projectId, status: status ?? null, id })).toString(
      'base64url',
    );
    const signature = createHmac('sha256', this.cursorSecret)
      .update(`acc:tasks:${data}`)
      .digest('base64url');
    return `${data}.${signature}`;
  }
  private decodeCursor(value: string, projectId: string, status: string | undefined) {
    try {
      const [data, signature, ...extra] = value.split('.');
      if (!data || !signature || extra.length) throw new Error();
      const actual = Buffer.from(signature, 'base64url');
      const expected = createHmac('sha256', this.cursorSecret).update(`acc:tasks:${data}`).digest();
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new Error();
      const cursor = z
        .strictObject({ projectId: z.uuid(), status: z.string().nullable(), id: z.uuid() })
        .parse(JSON.parse(Buffer.from(data, 'base64url').toString('utf8')));
      if (cursor.projectId !== projectId || cursor.status !== (status ?? null)) throw new Error();
      return cursor.id;
    } catch {
      throw new ApiError(400, 'CURSOR_INVALID');
    }
  }
  async tasks(projectId: string, principalId: string, query: unknown) {
    const input = taskQuerySchema.parse(query);
    const after = input.cursor ? this.decodeCursor(input.cursor, projectId, input.status) : null;
    return this.inProject(projectId, principalId, async (client) => {
      const rows = await client.query<{
        id: string;
        title: string;
        publicId: string;
        status: string;
        version: number;
        workRevision: number;
        workType: string;
      }>(
        `SELECT id,title,public_id AS "publicId",status,version,work_revision AS "workRevision",work_type AS "workType" FROM work_items WHERE project_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4`,
        [projectId, input.status ?? null, after, input.limit + 1],
      );
      const items = rows.rows.slice(0, input.limit);
      return {
        items,
        nextCursor:
          rows.rows.length > input.limit
            ? this.encodeCursor(projectId, input.status, items.at(-1)!.id)
            : null,
      };
    });
  }
  async task(projectId: string, principalId: string, taskId: string) {
    z.uuid().parse(taskId);
    return this.inProject(projectId, principalId, async (client) => {
      const found = await client.query<{
        id: string;
        title: string;
        status: string;
        version: number;
        workRevision: number;
        impactPending: boolean;
      }>(
        `SELECT id,title,public_id AS "publicId",status,version,work_revision AS "workRevision",work_type AS "workType",work_summary AS summary,criteria,impact_pending AS "impactPending",completion_version AS "completionVersion" FROM work_items WHERE project_id=$1 AND id=$2`,
        [projectId, taskId],
      );
      if (!found.rows[0]) throw new ApiError(404, 'TASK_NOT_FOUND');
      const evidence = await client.query(
        'SELECT id,kind,url,work_revision AS "workRevision",repository_id AS "repositoryId",commit_sha AS commit,test_result AS result,accepted_by AS "acceptedBy" FROM evidence WHERE project_id=$1 AND task_id=$2 ORDER BY created_at,id',
        [projectId, taskId],
      );
      const approvals = await client.query(
        'SELECT id,kind,work_revision AS "workRevision",principal_id AS "principalId",invalidated_at AS "invalidatedAt" FROM approvals WHERE project_id=$1 AND task_id=$2 ORDER BY created_at,id',
        [projectId, taskId],
      );
      const claim = await client.query(
        `SELECT c.principal_id AS "principalId",c.session_id AS "sessionId",c.expires_at AS "expiresAt",CASE WHEN c.principal_id=$3 THEN c.fencing_token::text ELSE NULL END AS "fencingToken" FROM task_claims c JOIN agent_sessions s ON s.id=c.session_id JOIN principals p ON p.id=c.principal_id WHERE c.project_id=$1 AND c.task_id=$2 AND NOT c.revoked AND c.expires_at>clock_timestamp() AND s.ended_at IS NULL AND s.expires_at>clock_timestamp() AND NOT p.disabled`,
        [projectId, taskId, principalId],
      );
      const validations = await client.query(
        'SELECT v.id,v.work_revision AS "workRevision",v.completion_version AS "completionVersion",v.principal_id AS "principalId",v.note,v.created_at AS "createdAt",(w.status=\'DONE\' AND w.completion_version=v.completion_version AND w.work_revision=v.work_revision) AS current FROM task_validations v JOIN work_items w ON w.project_id=v.project_id AND w.id=v.task_id WHERE v.project_id=$1 AND v.task_id=$2 ORDER BY v.created_at,v.id',
        [projectId, taskId],
      );
      const dependencies = await client.query(
        'SELECT d.depends_on AS id,w.public_id AS "publicId",w.status FROM task_dependencies d JOIN work_items w ON w.id=d.depends_on AND w.project_id=d.project_id WHERE d.project_id=$1 AND d.task_id=$2 ORDER BY d.depends_on',
        [projectId, taskId],
      );
      const requirements = await client.query(
        'SELECT r.id,r.public_id AS "publicId",r.version,r.approved_revision AS "approvedRevision",l.evaluated_revision AS "evaluatedRevision",(r.approved_revision IS NULL OR l.evaluated_revision IS DISTINCT FROM r.approved_revision) AS "impactPending" FROM requirement_task_links l JOIN requirements r ON r.project_id=l.project_id AND r.id=l.requirement_id WHERE l.project_id=$1 AND l.task_id=$2 ORDER BY r.id',
        [projectId, taskId],
      );
      const seq = await client.query<{ value: string }>(
        "SELECT value FROM project_counters WHERE project_id=$1 AND kind='EVENT'",
        [projectId],
      );
      return {
        ...found.rows[0],
        evidence: evidence.rows,
        approvals: approvals.rows,
        validations: validations.rows,
        claim: claim.rows[0] ?? null,
        dependencies: dependencies.rows,
        requirements: requirements.rows,
        projectSeq: seq.rows[0]?.value ?? '0',
      };
    });
  }
  async taskTime(projectId: string, principalId: string, taskId: string, query: unknown) {
    z.uuid().parse(taskId);
    const input = taskTimeQuerySchema.parse(query);
    return this.inProject(projectId, principalId, async (client) => {
      const found = await client.query('SELECT id FROM work_items WHERE project_id=$1 AND id=$2', [
        projectId,
        taskId,
      ]);
      if (!found.rowCount) throw new ApiError(404, 'TASK_NOT_FOUND');
      return readTaskWorkTime(client, projectId, taskId, input.timeZone);
    });
  }
  async sessions(projectId: string, principalId: string) {
    return this.inProject(
      projectId,
      principalId,
      async (client) =>
        (
          await client.query(
            'SELECT id,principal_id AS "principalId",version,expires_at AS "expiresAt",ended_at AS "endedAt" FROM agent_sessions WHERE project_id=$1 ORDER BY id',
            [projectId],
          )
        ).rows,
    );
  }
}
