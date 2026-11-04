export type ProjectSearch = {
  projectId?: string;
  taskId?: string;
  requirementId?: string;
  view?: 'accounts' | 'agents' | 'requirements';
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function parseProjectSearch(value: Record<string, unknown>): ProjectSearch {
  return {
    ...(value.view === 'accounts' || value.view === 'agents' || value.view === 'requirements'
      ? { view: value.view }
      : {}),
    ...Object.fromEntries(
      ['projectId', 'taskId', 'requirementId']
        .filter((k) => typeof value[k] === 'string' && uuid.test(value[k] as string))
        .map((k) => [k, value[k]]),
    ),
  };
}
