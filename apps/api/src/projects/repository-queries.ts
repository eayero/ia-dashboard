import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { repositoryQuerySchema } from '@acc/contracts';
import { ApiError } from '../common/errors.ts';
import type { ProjectQueries } from './queries.ts';

export class RepositoryQueries {
  constructor(
    private projects: ProjectQueries,
    private secret: string,
  ) {}

  private cursor(projectId: string, principalId: string, id: string) {
    const data = Buffer.from(JSON.stringify({ projectId, principalId, id })).toString('base64url');
    return `${data}.${createHmac('sha256', this.secret).update(`acc:repositories:${data}`).digest('base64url')}`;
  }

  async list(projectId: string, principalId: string, query: unknown) {
    const input = repositoryQuerySchema.parse(query);
    let after: string | null = null;
    if (input.cursor) {
      try {
        const [data, signature, ...extra] = input.cursor.split('.');
        if (!data || !signature || extra.length) throw new Error();
        const actual = Buffer.from(signature, 'base64url');
        const expected = createHmac('sha256', this.secret)
          .update(`acc:repositories:${data}`)
          .digest();
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
      const rows = await client.query<{ id: string; name: string; url: string }>(
        'SELECT id,name,url FROM repositories WHERE project_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
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
}
