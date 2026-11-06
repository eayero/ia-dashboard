export type GovernanceKind = 'questions' | 'decisions';
export type GovernanceItem = {
  id: string;
  publicId: string;
  title: string;
  version: number;
  status: string;
  priority?: string;
  revision?: number;
  approvedRevision?: number | null;
  createdBy: string;
  createdAt: string;
  creatorIdentity?: {
    agentName?: string | null;
    username?: string | null;
    ownerUsername?: string | null;
  } | null;
};
export const governanceStatus: Record<string, string> = {
  OPEN: 'Abierta',
  RESOLVED: 'Resuelta',
  CANCELLED: 'Cancelada',
  DRAFT: 'Borrador',
  APPROVED: 'Aprobada',
  SUPERSEDED: 'Sustituida',
};
export const priorityText: Record<string, string> = {
  LOW: 'Baja',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};
export function sortQuestions<T extends { priority?: string; publicId: string }>(items: T[]) {
  const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  return [...items].sort(
    (a, b) =>
      (rank[a.priority ?? 'NORMAL'] ?? 4) - (rank[b.priority ?? 'NORMAL'] ?? 4) ||
      a.publicId.localeCompare(b.publicId),
  );
}
