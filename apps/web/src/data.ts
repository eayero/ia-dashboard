import type { ContextRecord } from '@acc/contracts';
import { api, ApiError } from './api.ts';

export type SnapshotPage = {
  projectId: string;
  snapshotId: string;
  projectSeq: string;
  generatedAt: string;
  expiresAt: string;
  records: ContextRecord[];
  complete: boolean;
  nextCursor: string | null;
  changesCursor: string | null;
};
export type DashboardState = Omit<SnapshotPage, 'changesCursor'> & {
  changesCursor: string;
  checkedAt: number;
  snapshotAt: number;
};
export async function collectSnapshot(
  fetchPage: (cursor?: string) => Promise<SnapshotPage>,
): Promise<DashboardState> {
  let first: SnapshotPage | undefined;
  let cursor: string | undefined;
  const seen = new Set<string>();
  const records: ContextRecord[] = [];
  for (;;) {
    const page = await fetchPage(cursor);
    first ??= page;
    if (
      page.projectId !== first.projectId ||
      page.snapshotId !== first.snapshotId ||
      page.projectSeq !== first.projectSeq ||
      (page.complete
        ? !page.changesCursor || page.nextCursor !== null
        : !page.nextCursor || page.changesCursor !== null)
    )
      throw new ApiError('CONTEXT_INCONSISTENT');
    records.push(...page.records);
    if (page.complete)
      return {
        ...first,
        records,
        complete: true,
        nextCursor: null,
        changesCursor: page.changesCursor!,
        checkedAt: Date.now(),
        snapshotAt: Date.now(),
      };
    if (seen.has(page.nextCursor!)) throw new ApiError('CONTEXT_INCONSISTENT');
    seen.add(page.nextCursor!);
    cursor = page.nextCursor!;
  }
}
export async function dashboard(
  projectId: string,
  previous: DashboardState | undefined,
  signal: AbortSignal,
) {
  if (previous && Date.now() - previous.snapshotAt < 60000) {
    try {
      let cursor = previous.changesCursor;
      let changed = false;
      const seen = new Set<string>();
      for (;;) {
        const delta = await api<{
          events: unknown[];
          nextCursor: string | null;
          changesCursor: string;
          throughSeq: string;
        }>(`/projects/${projectId}/events?cursor=${encodeURIComponent(cursor)}&limit=100`, {
          signal,
        });
        changed ||= delta.events.length > 0;
        if (!delta.nextCursor) {
          if (!changed)
            return { ...previous, changesCursor: delta.changesCursor, checkedAt: Date.now() };
          break;
        }
        if (seen.has(delta.nextCursor)) throw new ApiError('CONTEXT_INCONSISTENT');
        seen.add(delta.nextCursor);
        cursor = delta.nextCursor;
      }
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        !['CURSOR_INVALID', 'CONTEXT_EXPIRED', 'CURSOR_AHEAD', 'EVENT_GAP'].includes(error.code)
      )
        throw error;
    }
  }
  return collectSnapshot((cursor) =>
    api<SnapshotPage>(
      `/projects/${projectId}/context?${cursor ? `cursor=${encodeURIComponent(cursor)}` : 'limit=100'}`,
      { signal },
    ),
  );
}
export function entities<T>(state: DashboardState, type: string): T[] {
  return state.records
    .filter((record) => record.entityType === type)
    .map((record) => record.data as T);
}
export type Project = { id: string; name: string; archived: boolean; claimsPaused: boolean };
export type Member = {
  ownerUserId?: string | null;
  ownerUsername?: string | null;
  agentName?: string | null;
  principalId: string;
  kind: string;
  active: boolean;
  disabled: boolean;
  roles: string[];
};
export type Task = {
  id: string;
  publicId: string;
  title: string;
  status: string;
  version: number;
  workRevision: number;
  workType: string;
  summary: string;
  criteria: { id: string; description: string; required: boolean }[];
  impactPending: boolean;
};
export type Claim = {
  taskId: string;
  principalId: string;
  sessionId: string;
  expiresAt: string;
  fencingToken: string | null;
  active: boolean;
};
export type Session = {
  id: string;
  principalId: string;
  version: number;
  expiresAt: string;
  endedAt: string | null;
};
export type TaskDetail = Task & {
  requirements: {
    id: string;
    publicId: string;
    version: number;
    approvedRevision: number | null;
    evaluatedRevision: number | null;
    impactPending: boolean;
  }[];
  completionVersion: number | null;
  validations: {
    id: string;
    workRevision: number;
    completionVersion: number;
    principalId: string;
    note: string;
    createdAt: string;
    current: boolean;
  }[];
  claim: Omit<Claim, 'taskId' | 'active'> | null;
  evidence: {
    id: string;
    kind: string;
    url: string;
    workRevision: number;
    acceptedBy: string | null;
    commit: string | null;
  }[];
  approvals: { id: string; kind: string; workRevision: number; invalidatedAt: string | null }[];
  dependencies: { id: string; publicId: string; status: string }[];
};
export const statusText: Record<string, string> = {
  BACKLOG: 'Por planificar',
  READY: 'Lista',
  IN_PROGRESS: 'En ejecución',
  BLOCKED: 'Bloqueada',
  IN_REVIEW: 'En revisión',
  IN_QA: 'En QA',
  DONE: 'Completada',
  CANCELLED: 'Cancelada',
};
