import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type pg from 'pg';
import {
  contextQuerySchema,
  eventsQuerySchema,
  sequenceSchema,
  type ContextRecord,
} from '@acc/contracts';
import { eventFromRow, type AuditEventRow } from '@acc/db';
import { ApiError } from '../common/errors.ts';
import { ProjectQueries } from './queries.ts';
import { materializeContextSql } from './context-sql.ts';

const identity = { projectId: z.uuid(), principalId: z.uuid() };
const cursorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...identity,
    kind: z.literal('snapshot'),
    id: z.uuid(),
    page: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...identity,
    kind: z.literal('changes'),
    afterSeq: sequenceSchema,
    throughSeq: sequenceSchema.nullable(),
  }),
]);
type Cursor = z.infer<typeof cursorSchema>;
type Manifest = {
  id: string;
  seq: string;
  page_size: number;
  page_count: number;
  created_at: Date;
  expires_at: Date;
};
export class ProjectContext {
  constructor(
    private queries: ProjectQueries,
    private secret: string,
  ) {}
  private encode(cursor: Cursor) {
    const value = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return `${value}.${createHmac('sha256', this.secret).update(`acc:context:v1:${value}`).digest('base64url')}`;
  }
  private decode(value: string, projectId: string, principalId: string): Cursor {
    try {
      const [data, signature, ...extra] = value.split('.');
      if (!data || !signature || extra.length) throw new Error();
      const expected = createHmac('sha256', this.secret).update(`acc:context:v1:${data}`).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new Error();
      const cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(data, 'base64url').toString('utf8')),
      );
      if (cursor.projectId !== projectId || cursor.principalId !== principalId) throw new Error();
      return cursor;
    } catch {
      throw new ApiError(400, 'CURSOR_INVALID', { snapshotRequired: true });
    }
  }
  private async highWater(client: pg.PoolClient, projectId: string) {
    const result = await client.query<{ value: string }>(
      "SELECT value FROM project_counters WHERE project_id=$1 AND kind='EVENT'",
      [projectId],
    );
    return result.rows[0]?.value ?? '0';
  }
  async snapshot(projectId: string, principalId: string, query: unknown) {
    const input = contextQuerySchema.parse(query);
    return this.queries.inProject(
      projectId,
      principalId,
      async (client) => {
        let id: string, page: number;
        if (input.cursor) {
          const cursor = this.decode(input.cursor, projectId, principalId);
          if (cursor.kind !== 'snapshot')
            throw new ApiError(400, 'CURSOR_INVALID', { snapshotRequired: true });
          id = cursor.id;
          page = cursor.page;
        } else {
          await client.query("SET LOCAL statement_timeout='30s'");
          id = randomUUID();
          page = 0;
          const seq = await this.highWater(client, projectId);
          const limit = input.limit ?? 20;
          await client.query(
            'INSERT INTO context_snapshots(id,project_id,principal_id,seq,page_size) VALUES ($1,$2,$3,$4,$5)',
            [id, projectId, principalId, seq, limit],
          );
          await client.query(materializeContextSql, [projectId, principalId, limit, id]);
          await client.query(
            'UPDATE context_snapshots SET page_count=(SELECT max(page_index)+1 FROM context_snapshot_pages WHERE snapshot_id=$1) WHERE id=$1',
            [id],
          );
        }
        const found = await client.query<Manifest>(
          'SELECT id,seq,page_size,page_count,created_at,expires_at FROM context_snapshots WHERE id=$1 AND project_id=$2 AND principal_id=$3 AND expires_at>clock_timestamp()',
          [id, projectId, principalId],
        );
        const manifest = found.rows[0];
        if (!manifest) throw new ApiError(409, 'CONTEXT_EXPIRED', { snapshotRequired: true });
        if (
          page >= manifest.page_count ||
          (input.limit !== undefined && input.limit !== manifest.page_size)
        )
          throw new ApiError(400, 'CURSOR_INVALID', { snapshotRequired: true });
        const content = await client.query<{ records: ContextRecord[] }>(
          'SELECT records FROM context_snapshot_pages WHERE snapshot_id=$1 AND page_index=$2',
          [id, page],
        );
        if (!content.rows[0])
          throw new ApiError(409, 'CONTEXT_EXPIRED', { snapshotRequired: true });
        const complete = page + 1 === manifest.page_count;
        return {
          schemaVersion: 1 as const,
          projectId,
          snapshotId: id,
          projectSeq: manifest.seq,
          generatedAt: manifest.created_at.toISOString(),
          expiresAt: manifest.expires_at.toISOString(),
          records: content.rows[0].records,
          complete,
          nextCursor: complete
            ? null
            : this.encode({ kind: 'snapshot', projectId, principalId, id, page: page + 1 }),
          changesCursor: complete
            ? this.encode({
                kind: 'changes',
                projectId,
                principalId,
                afterSeq: manifest.seq,
                throughSeq: null,
              })
            : null,
        };
      },
      Boolean(input.cursor),
    );
  }
  async changes(projectId: string, principalId: string, query: unknown) {
    const input = eventsQuerySchema.parse(query);
    return this.queries.inProject(projectId, principalId, async (client) => {
      const current = await this.highWater(client, projectId);
      let afterSeq = input.afterSeq ?? '0',
        throughSeq = current;
      if (input.cursor) {
        const cursor = this.decode(input.cursor, projectId, principalId);
        if (cursor.kind !== 'changes')
          throw new ApiError(400, 'CURSOR_INVALID', { snapshotRequired: true });
        afterSeq = cursor.afterSeq;
        throughSeq = cursor.throughSeq ?? current;
      }
      if (BigInt(afterSeq) > BigInt(throughSeq) || BigInt(throughSeq) > BigInt(current))
        throw new ApiError(409, 'CURSOR_AHEAD', { snapshotRequired: true });
      const result = await client.query<AuditEventRow>(
        'SELECT * FROM audit_events WHERE project_id=$1 AND seq>$2 AND seq<=$3 ORDER BY seq LIMIT $4',
        [projectId, afterSeq, throughSeq, input.limit + 1],
      );
      let expected = BigInt(afterSeq) + 1n;
      for (const row of result.rows) {
        if (BigInt(row.seq) !== expected)
          throw new ApiError(409, 'EVENT_GAP', { snapshotRequired: true });
        expected++;
      }
      if (result.rows.length <= input.limit && expected - 1n < BigInt(throughSeq))
        throw new ApiError(409, 'EVENT_GAP', { snapshotRequired: true });
      const more = result.rows.length > input.limit;
      const rows = result.rows.slice(0, input.limit);
      return {
        schemaVersion: 1 as const,
        projectId,
        projectSeq: throughSeq,
        throughSeq,
        events: rows.map(eventFromRow),
        complete: !more,
        nextCursor: more
          ? this.encode({
              kind: 'changes',
              projectId,
              principalId,
              afterSeq: rows.at(-1)!.seq,
              throughSeq,
            })
          : null,
        changesCursor: more
          ? null
          : this.encode({
              kind: 'changes',
              projectId,
              principalId,
              afterSeq: throughSeq,
              throughSeq: null,
            }),
      };
    });
  }
}
