export type Iteration = {
  id: string;
  publicId: string;
  name: string;
  goal: string;
  startsOn: string;
  endsOn: string;
  status: string;
  version: number;
  requirementCount?: number;
  taskCount?: number;
  pendingTasks?: number;
};
export const sprintText: Record<string, string> = {
  PLANNED: 'Planificado',
  ACTIVE: 'En ejecución',
  PAUSED: 'Pausado',
  COMPLETED: 'Finalizado',
  CANCELLED: 'Cancelado',
};
export function inheritedSprint(
  primary: string | null,
  requirements: { id: string; sprintId?: string | null }[],
) {
  return requirements.find((r) => r.id === primary)?.sprintId ?? null;
}
export function executionMessage(code: string | null | undefined) {
  return code === 'PRIMARY_REQUIREMENT_REQUIRED'
    ? 'Elige un requisito principal para planificar esta tarea.'
    : code === 'SPRINT_REQUIRED'
      ? 'Asigna un sprint al requisito principal antes de trabajar.'
      : code === 'SPRINT_NOT_ACTIVE'
        ? 'El sprint debe estar en ejecución para trabajar en esta tarea.'
        : '';
}
