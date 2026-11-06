import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { governanceQuerySchema } from '@acc/contracts';
import type { ProjectQueries } from './queries.ts';
import { ApiError } from '../common/errors.ts';
export type GovernanceKind = 'questions' | 'decisions';
export class GovernanceQueries {
  constructor(
    private projects: ProjectQueries,
    private secret: string,
  ) {}
  async list(projectId: string, principalId: string, kind: GovernanceKind, query: unknown) {
    const input = governanceQuerySchema.parse(query);
    let after: string | null = null;
    const scope = {
      projectId,
      principalId,
      kind,
      status: input.status ?? null,
      priority: input.priority ?? null,
    };
    if (input.cursor)
      try {
        const [raw, sig, ...extra] = input.cursor.split('.');
        if (!raw || !sig || extra.length) throw Error();
        const expected = createHmac('sha256', this.secret)
            .update('governance:' + raw)
            .digest(),
          actual = Buffer.from(sig, 'base64url');
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw Error();
        const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        if (Object.entries(scope).some(([k, v]) => c[k] !== v)) throw Error();
        after = z.uuid().parse(c.id);
      } catch {
        throw new ApiError(400, 'CURSOR_INVALID');
      }
    return this.projects.inProject(projectId, principalId, async (client) => {
      const fields =
        kind === 'questions'
          ? `e.title,e.description,e.priority,e.status`
          : `v.title,v.status,e.current_revision AS revision,e.approved_revision AS "approvedRevision"`;
      const join =
        kind === 'questions'
          ? ''
          : `JOIN decision_revisions v ON v.project_id=e.project_id AND v.decision_id=e.id AND v.revision=e.current_revision`;
      const status = kind === 'questions' ? 'e.status' : 'v.status';
      const rows = (
        await client.query(
          `SELECT e.id,e.public_id AS "publicId",e.version,e.created_by AS "createdBy",e.created_at AS "createdAt",e.creator_identity AS "creatorIdentity",${fields} FROM ${kind} e ${join} WHERE e.project_id=$1 AND ($2::uuid IS NULL OR e.id>$2) AND ($3::text IS NULL OR ${status}=$3) ${kind === 'questions' ? 'AND ($4::text IS NULL OR e.priority=$4)' : 'AND ($4::text IS NULL)'} ORDER BY e.id LIMIT $5`,
          [projectId, after, input.status ?? null, input.priority ?? null, input.limit + 1],
        )
      ).rows;
      const items = rows.slice(0, input.limit);
      let nextCursor: string | null = null;
      if (rows.length > input.limit) {
        const raw = Buffer.from(JSON.stringify({ ...scope, id: items.at(-1)!.id })).toString(
          'base64url',
        );
        nextCursor =
          raw +
          '.' +
          createHmac('sha256', this.secret)
            .update('governance:' + raw)
            .digest('base64url');
      }
      return { items, nextCursor };
    });
  }
  async detail(projectId: string, principalId: string, kind: GovernanceKind, id: string) {
    z.uuid().parse(id);
    return this.projects.inProject(projectId, principalId, async (client) => {
      const row = (
        await client.query(
          `SELECT e.id,e.public_id AS "publicId",e.external_ref AS "externalRef",e.version,e.created_by AS "createdBy",e.created_at AS "createdAt",e.creator_identity AS "creatorIdentity"${kind === 'questions' ? ',e.title,e.description,e.priority,e.status,e.accepted_answer_id AS "acceptedAnswerId"' : ',e.current_revision AS revision,e.approved_revision AS "approvedRevision"'} FROM ${kind} e WHERE e.project_id=$1 AND e.id=$2`,
          [projectId, id],
        )
      ).rows[0];
      if (!row)
        throw new ApiError(404, kind === 'questions' ? 'QUESTION_NOT_FOUND' : 'DECISION_NOT_FOUND');
      const singular = kind === 'questions' ? 'question' : 'decision';
      const tasks = (
        await client.query(
          `SELECT l.task_id AS "taskId",w.public_id AS "publicId",w.title,w.version AS "taskVersion",w.status,${kind === 'questions' ? 'l.hard' : 'l.evaluated_revision AS "evaluatedRevision"'} FROM ${singular}_task_links l JOIN work_items w ON w.project_id=l.project_id AND w.id=l.task_id WHERE l.project_id=$1 AND l.${singular}_id=$2 ORDER BY w.id`,
          [projectId, id],
        )
      ).rows;
      const requirements = (
        await client.query(
          `SELECT l.requirement_id AS id,r.public_id AS "publicId" FROM ${singular}_requirement_links l JOIN requirements r ON r.project_id=l.project_id AND r.id=l.requirement_id WHERE l.project_id=$1 AND l.${singular}_id=$2 ORDER BY r.id`,
          [projectId, id],
        )
      ).rows;
      if (kind === 'questions')
        return {
          ...row,
          tasks,
          requirements,
          answers: (
            await client.query(
              'SELECT a.id,a.text,a.created_by AS "createdBy",a.created_at AS "createdAt",a.creator_identity AS "creatorIdentity" FROM question_answers a WHERE a.project_id=$1 AND a.question_id=$2 ORDER BY a.created_at,a.id',
              [projectId, id],
            )
          ).rows,
          resolutions: (
            await client.query(
              'SELECT id,answer_id AS "answerId",action,reason,principal_id AS "principalId",created_at AS "createdAt" FROM question_resolutions WHERE project_id=$1 AND question_id=$2 ORDER BY created_at,id',
              [projectId, id],
            )
          ).rows,
        };
      return {
        ...row,
        tasks,
        requirements,
        revisions: (
          await client.query(
            'SELECT revision,title,context,alternatives,choice,rationale,reason,status,created_by AS "createdBy",created_at AS "createdAt",approved_by AS "approvedBy",approved_at AS "approvedAt" FROM decision_revisions WHERE project_id=$1 AND decision_id=$2 ORDER BY revision',
            [projectId, id],
          )
        ).rows,
        questions: (
          await client.query(
            'SELECT q.id,q.public_id AS "publicId",q.title,q.status FROM decision_question_links l JOIN questions q ON q.project_id=l.project_id AND q.id=l.question_id WHERE l.project_id=$1 AND l.decision_id=$2 ORDER BY q.id',
            [projectId, id],
          )
        ).rows,
        impactReviews: (
          await client.query(
            'SELECT id,task_id AS "taskId",revision,reason,principal_id AS "principalId",created_at AS "createdAt" FROM decision_impact_reviews WHERE project_id=$1 AND decision_id=$2 ORDER BY created_at,id',
            [projectId, id],
          )
        ).rows,
      };
    });
  }
}
