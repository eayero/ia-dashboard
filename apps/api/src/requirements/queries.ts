import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { readEntityAttribution } from '@acc/db';
import { requirementQuerySchema } from '@acc/contracts';
import { ApiError } from '../common/errors.ts';
import type { ProjectQueries } from '../projects/queries.ts';

export class RequirementQueries {
  constructor(
    private projects: ProjectQueries,
    private secret: string,
  ) {}
  private cursor(projectId: string, principalId: string, id: string) {
    const data = Buffer.from(JSON.stringify({ projectId, principalId, id })).toString('base64url');
    return `${data}.${createHmac('sha256', this.secret).update(`acc:requirements:${data}`).digest('base64url')}`;
  }
  async list(projectId: string, principalId: string, query: unknown) {
    const input = requirementQuerySchema.parse(query);
    let after: string | null = null;
    if (input.cursor) {
      try {
        const [data, signature, ...extra] = input.cursor.split('.');
        if (!data || !signature || extra.length) throw new Error();
        const actual = Buffer.from(signature, 'base64url'),
          expected = createHmac('sha256', this.secret).update(`acc:requirements:${data}`).digest();
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
          throw new Error();
        const cursor = z
          .strictObject({ projectId: z.uuid(), principalId: z.uuid(), id: z.uuid() })
          .parse(JSON.parse(Buffer.from(data, 'base64url').toString('utf8')));
        if (cursor.projectId !== projectId || cursor.principalId !== principalId) throw new Error();
        after = cursor.id;
      } catch {
        throw new ApiError(400, 'CURSOR_INVALID');
      }
    }
    return this.projects.inProject(projectId, principalId, async (client) => {
      const rows = await client.query<{ id: string }>(
        `SELECT r.id,r.public_id AS "publicId",r.version,r.current_revision AS revision,r.approved_revision AS "approvedRevision",r.sprint_id AS "sprintId",v.title,v.type,v.status FROM requirements r JOIN requirement_revisions v ON v.project_id=r.project_id AND v.requirement_id=r.id AND v.revision=r.current_revision WHERE r.project_id=$1 AND ($2::uuid IS NULL OR r.id>$2) ORDER BY r.id LIMIT $3`,
        [projectId, after, input.limit + 1],
      );
      const items = rows.rows.slice(0, input.limit);
      return {
        items,
        nextCursor:
          rows.rows.length > input.limit
            ? this.cursor(projectId, principalId, items.at(-1)!.id)
            : null,
      };
    });
  }
  async detail(projectId: string, principalId: string, id: string) {
    z.uuid().parse(id);
    return this.projects.inProject(projectId, principalId, async (client) => {
      const found = await client.query(
        'SELECT id,public_id AS "publicId",external_ref AS "externalRef",sprint_id AS "sprintId",version,current_revision AS revision,approved_revision AS "approvedRevision",created_by AS "createdBy",created_at AS "createdAt" FROM requirements WHERE project_id=$1 AND id=$2',
        [projectId, id],
      );
      if (!found.rows[0]) throw new ApiError(404, 'REQUIREMENT_NOT_FOUND');
      const revisions = await client.query(
        'SELECT revision,type,title,description,reason,status,created_by AS "createdBy",created_at AS "createdAt",approved_by AS "approvedBy",approved_at AS "approvedAt" FROM requirement_revisions WHERE project_id=$1 AND requirement_id=$2 ORDER BY revision',
        [projectId, id],
      );
      const links = await client.query(
        'SELECT l.task_id AS "taskId",w.public_id AS "publicId",w.version AS "taskVersion",l.evaluated_revision AS "evaluatedRevision",(r.approved_revision IS NULL OR l.evaluated_revision IS DISTINCT FROM r.approved_revision) AS "impactPending" FROM requirement_task_links l JOIN work_items w ON w.project_id=l.project_id AND w.id=l.task_id JOIN requirements r ON r.project_id=l.project_id AND r.id=l.requirement_id WHERE l.project_id=$1 AND l.requirement_id=$2 ORDER BY l.task_id',
        [projectId, id],
      );
      const reviews = await client.query(
        'SELECT id,task_id AS "taskId",revision,reason,principal_id AS "principalId",created_at AS "createdAt" FROM requirement_impact_reviews WHERE project_id=$1 AND requirement_id=$2 ORDER BY created_at,id',
        [projectId, id],
      );
      return {
        ...found.rows[0],
        creator: (
          await readEntityAttribution(client, projectId, id, 'REQUIREMENT', 'America/Caracas')
        ).creator,
        sprint:
          (
            await client.query(
              'SELECT i.id,i.public_id AS "publicId",i.name,i.status FROM requirements r JOIN iterations i ON i.project_id=r.project_id AND i.id=r.sprint_id WHERE r.project_id=$1 AND r.id=$2',
              [projectId, id],
            )
          ).rows[0] ?? null,
        revisions: revisions.rows,
        links: links.rows,
        impactReviews: reviews.rows,
      };
    });
  }
}
