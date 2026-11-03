export type TaskStatus =
  'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'IN_REVIEW' | 'IN_QA' | 'DONE' | 'CANCELLED';
export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'REVIEWER' | 'VIEWER';
export type Actor = { kind: 'HUMAN' | 'AGENT'; roles: Role[]; scopes: string[] };
export type Criterion = {
  id: string;
  description: string;
  required: boolean;
  verified: boolean;
  evidenceIds: string[];
};
export type TransitionInput = {
  from: TaskStatus;
  to: TaskStatus;
  actor: Actor;
  hasClaim: boolean;
  criteria: Criterion[];
  evidenceAccepted: boolean;
  dependenciesMet: boolean;
  impactPending: boolean;
  reviewApproved: boolean;
  qaApproved: boolean;
  closureApproved: boolean;
  reason?: string;
};
export class DomainError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, details: unknown = undefined) {
    super(code);
    this.code = code;
    this.details = details;
  }
}
export function transition(input: TransitionInput): { status: TaskStatus; releaseClaim: boolean } {
  const { from, to, actor } = input;
  const fail = (code: string): never => {
    throw new DomainError(code);
  };
  const manages =
    actor.kind === 'HUMAN' && actor.roles.some((r) => ['OWNER', 'ADMIN', 'MANAGER'].includes(r));
  const reviews =
    actor.kind === 'HUMAN' && actor.roles.some((r) => ['OWNER', 'ADMIN', 'REVIEWER'].includes(r));
  const writes =
    manages || reviews || (actor.kind === 'AGENT' && actor.scopes.includes('task:write'));
  if (!writes) fail('FORBIDDEN');
  const edges: Record<TaskStatus, TaskStatus[]> = {
    BACKLOG: ['READY', 'CANCELLED'],
    READY: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['BLOCKED', 'IN_REVIEW', 'CANCELLED'],
    BLOCKED: ['READY', 'CANCELLED'],
    IN_REVIEW: ['IN_QA', 'IN_PROGRESS', 'CANCELLED'],
    IN_QA: ['DONE', 'IN_PROGRESS', 'CANCELLED'],
    DONE: ['READY'],
    CANCELLED: [],
  };
  if (!edges[from].includes(to)) fail('INVALID_TRANSITION');
  if ((['READY', 'CANCELLED'].includes(to) || from === 'DONE') && !manages) fail('FORBIDDEN');
  if (
    (['IN_QA', 'DONE'].includes(to) ||
      (to === 'IN_PROGRESS' && ['IN_QA', 'IN_REVIEW'].includes(from))) &&
    !reviews
  )
    fail('FORBIDDEN');
  if (
    (to === 'CANCELLED' ||
      from === 'DONE' ||
      to === 'BLOCKED' ||
      (to === 'IN_PROGRESS' && from !== 'READY')) &&
    !input.reason?.trim()
  )
    fail('REASON_REQUIRED');
  if (['READY', 'IN_PROGRESS', 'IN_REVIEW', 'IN_QA', 'DONE'].includes(to) && !input.dependenciesMet)
    fail('DEPENDENCIES_UNMET');
  if (['IN_REVIEW', 'IN_QA', 'DONE'].includes(to) && input.impactPending)
    fail('IMPACT_REVIEW_REQUIRED');
  if (
    (from === 'READY' && to === 'IN_PROGRESS') ||
    (from === 'IN_PROGRESS' && ['BLOCKED', 'IN_REVIEW'].includes(to))
  ) {
    if (!input.hasClaim) fail('CLAIM_REQUIRED');
  }
  if (
    ['READY', 'IN_REVIEW', 'DONE'].includes(to) &&
    (input.criteria.length === 0 || input.criteria.some((c) => !c.description.trim()))
  )
    fail('CRITERIA_REQUIRED');
  if (['IN_REVIEW', 'DONE'].includes(to)) {
    if (!input.evidenceAccepted) fail('EVIDENCE_REQUIRED');
    if (input.criteria.some((c) => c.required && (!c.verified || c.evidenceIds.length === 0)))
      fail('CRITERIA_UNMET');
  }
  if (['IN_QA', 'DONE'].includes(to) && !input.reviewApproved) fail('REVIEW_REQUIRED');
  if (to === 'DONE' && !input.qaApproved) fail('QA_REQUIRED');
  if (to === 'DONE' && !input.closureApproved) fail('HUMAN_APPROVAL_REQUIRED');
  return { status: to, releaseClaim: to !== 'IN_PROGRESS' || from !== 'READY' };
}
export function normalizeTitle(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}
export type Approval = {
  kind: 'REVIEW' | 'QA' | 'CLOSURE';
  workRevision: number;
  approved: boolean;
  actor: Actor;
};
export function approvalGates(workRevision: number, approvals: readonly Approval[]) {
  const accepted = (kind: Approval['kind']) =>
    approvals.some(
      (a) =>
        a.kind === kind &&
        a.workRevision === workRevision &&
        a.approved &&
        a.actor.kind === 'HUMAN' &&
        a.actor.roles.some((r) => ['OWNER', 'ADMIN', 'REVIEWER'].includes(r)),
    );
  return {
    reviewApproved: accepted('REVIEW'),
    qaApproved: accepted('QA'),
    closureApproved: accepted('CLOSURE'),
  };
}
export type Claim = {
  principalId: string;
  sessionId: string;
  fencingToken: bigint;
  expiresAt: number;
  revoked: boolean;
};
export type ClaimWrite = {
  principalId: string;
  sessionId: string;
  fencingToken: bigint;
  expectedVersion: number;
  actualVersion: number;
  now: number;
  sessionActive: boolean;
};
// The persistence layer must supply PostgreSQL time and lock the task before calling.
export function assertClaim(claim: Claim | null, write: ClaimWrite): void {
  if (!claim) throw new DomainError('CLAIM_REQUIRED');
  if (
    claim.revoked ||
    !write.sessionActive ||
    claim.expiresAt <= write.now ||
    claim.principalId !== write.principalId ||
    claim.sessionId !== write.sessionId ||
    claim.fencingToken !== write.fencingToken
  )
    throw new DomainError('STALE_CLAIM');
  if (write.expectedVersion !== write.actualVersion) throw new DomainError('VERSION_CONFLICT');
}
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean')
      return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || ancestors.has(item)) throw new DomainError('INVALID_JSON');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return `[${Array.from(item, encode).join(',')}]`;
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new DomainError('INVALID_JSON');
      return `{${Object.entries(item)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${encode(v)}`)
        .join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  };
  return encode(value);
}
