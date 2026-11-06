import { z } from 'zod';
import { participantQuerySchema, requirementQuerySchema } from '@acc/contracts';
import { readEntityAttribution } from '@acc/db';
import type { ProjectQueries } from './queries.ts';
import { ApiError } from '../common/errors.ts';
import { createHmac, timingSafeEqual } from 'node:crypto';

export class PlanningQueries {
  constructor(
    private projects: ProjectQueries,
    private secret: string,
  ) {}
  async iterations(projectId: string, principalId: string, query: unknown) {
    const input = requirementQuerySchema.parse(query);
    let after: string | null = null;
    if (input.cursor) {
      try {
        const [raw, sig, ...extra] = input.cursor.split('.');
        if (!raw || !sig || extra.length) throw Error();
        const expected = createHmac('sha256', this.secret)
            .update('iterations:' + raw)
            .digest(),
          actual = Buffer.from(sig, 'base64url');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error();
        const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (c.projectId !== projectId || c.principalId !== principalId) throw Error();
        after = z.uuid().parse(c.id);
      } catch {
        throw new ApiError(400, 'CURSOR_INVALID');
      }
    }
    return this.projects.inProject(projectId, principalId, async (client) => {
      const rows = (
        await client.query(
          `SELECT i.id,i.public_id AS "publicId",i.name,i.goal,to_char(i.starts_on,'YYYY-MM-DD') AS "startsOn",to_char(i.ends_on,'YYYY-MM-DD') AS "endsOn",i.status,i.version,i.created_by AS "createdBy",i.created_at AS "createdAt",(SELECT count(*)::int FROM requirements r WHERE r.project_id=i.project_id AND r.sprint_id=i.id) AS "requirementCount",(SELECT count(*)::int FROM work_items w JOIN requirements r ON r.project_id=w.project_id AND r.id=w.primary_requirement_id WHERE r.project_id=i.project_id AND r.sprint_id=i.id) AS "taskCount",(SELECT count(*)::int FROM work_items w JOIN requirements r ON r.project_id=w.project_id AND r.id=w.primary_requirement_id WHERE r.project_id=i.project_id AND r.sprint_id=i.id AND w.status NOT IN ('DONE','CANCELLED')) AS "pendingTasks" FROM iterations i WHERE i.project_id=$1 AND ($2::uuid IS NULL OR i.id>$2) ORDER BY i.id LIMIT $3`,
          [projectId, after, input.limit + 1],
        )
      ).rows;
      const items = rows.slice(0, input.limit);
      let nextCursor: string | null = null;
      if (rows.length > input.limit) {
        const raw = Buffer.from(
          JSON.stringify({ projectId, principalId, id: items.at(-1)!.id }),
        ).toString('base64url');
        nextCursor =
          raw +
          '.' +
          createHmac('sha256', this.secret)
            .update('iterations:' + raw)
            .digest('base64url');
      }
      return { items, nextCursor };
    });
  }
  async participants(projectId: string, principalId: string, query: unknown) {
    const input = participantQuerySchema.parse(query);
    return this.projects.inProject(projectId, principalId, (client) =>
      readEntityAttribution(client, projectId, input.entityId, input.entityType, input.timeZone),
    );
  }
}
