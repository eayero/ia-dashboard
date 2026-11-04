import { ApiError } from './api.ts';
import { entities, type DashboardState, type Task } from './data.ts';

export type Requirement = {
  id: string;
  publicId: string;
  version: number;
  revision: number;
  approvedRevision: number | null;
};
export type RequirementRevision = {
  requirementId?: string;
  revision: number;
  type: 'FUNCTIONAL' | 'NON_FUNCTIONAL';
  title: string;
  description: string;
  reason: string;
  status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
};
export type RequirementLink = {
  requirementId: string;
  taskId: string;
  evaluatedRevision: number | null;
  approvedRevision: number | null;
  impactPending: boolean;
};
export type RequirementDetail = Requirement & {
  externalRef: string | null;
  createdBy: string;
  createdAt: string;
  revisions: RequirementRevision[];
  links: {
    taskId: string;
    publicId: string;
    taskVersion: number;
    evaluatedRevision: number | null;
    impactPending: boolean;
  }[];
  impactReviews: {
    id: string;
    taskId: string;
    revision: number;
    reason: string;
    principalId: string;
    createdAt: string;
  }[];
};
export type RequirementItem = Requirement & {
  current: RequirementRevision;
  approved: RequirementRevision | null;
  pendingProposal: boolean;
  pendingImpacts: number;
  linkedTasks: number;
};
export function requirementCatalog(state: DashboardState): RequirementItem[] {
  const revisions = entities<RequirementRevision>(state, 'REQUIREMENT_REVISION'),
    links = entities<RequirementLink>(state, 'REQUIREMENT_LINK');
  return entities<Requirement>(state, 'REQUIREMENT')
    .map((r) => {
      const current = revisions.find((v) => v.requirementId === r.id && v.revision === r.revision);
      const approved =
        r.approvedRevision === null
          ? null
          : revisions.find((v) => v.requirementId === r.id && v.revision === r.approvedRevision);
      if (!current || approved === undefined) throw new ApiError('CONTEXT_INCONSISTENT');
      const linked = links.filter((l) => l.requirementId === r.id);
      return {
        ...r,
        current,
        approved,
        pendingProposal: current.status === 'DRAFT',
        pendingImpacts: linked.filter((l) => l.impactPending).length,
        linkedTasks: linked.length,
      };
    })
    .sort((a, b) => a.publicId.localeCompare(b.publicId, 'es', { numeric: true }));
}
export function filterRequirements(
  items: RequirementItem[],
  search: string,
  type: string,
  filter: string,
) {
  const query = search.trim().toLocaleLowerCase('es');
  return items.filter(
    (r) =>
      (type === 'ALL' || r.current.type === type) &&
      (filter === 'ALL' || (filter === 'PROPOSAL' ? r.pendingProposal : r.pendingImpacts > 0)) &&
      `${r.publicId} ${r.current.title}`.toLocaleLowerCase('es').includes(query),
  );
}
export function requirementAttention(state: DashboardState) {
  const requirements = entities<Requirement>(state, 'REQUIREMENT'),
    tasks = entities<Task>(state, 'TASK');
  const seen = new Set<string>();
  return entities<RequirementLink>(state, 'REQUIREMENT_LINK')
    .filter((l) => l.impactPending)
    .flatMap((link) => {
      const requirement = requirements.find((r) => r.id === link.requirementId),
        task = tasks.find((t) => t.id === link.taskId),
        key = `${link.requirementId}:${link.taskId}`;
      if (!requirement || !task || seen.has(key)) return [];
      seen.add(key);
      return [
        {
          ...link,
          key,
          publicId: requirement.publicId,
          taskPublicId: task.publicId,
          taskTitle: task.title,
          completed: task.status === 'DONE',
        },
      ];
    });
}
