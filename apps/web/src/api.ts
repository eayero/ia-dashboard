export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  constructor(code: string, status = 0, requestId?: string) {
    super(code);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}
export async function api<T>(
  path: string,
  options: { signal?: AbortSignal; body?: unknown; csrf?: string; key?: string } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      headers:
        options.body === undefined
          ? {}
          : {
              'content-type': 'application/json',
              'x-csrf-token': options.csrf ?? '',
              'idempotency-key': options.key ?? '',
            },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError('NETWORK_ERROR');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/me')
      window.dispatchEvent(new Event('acc:auth-expired'));
    throw new ApiError(body?.error?.code ?? 'HTTP_ERROR', response.status, body?.error?.requestId);
  }
  if (!body || !Object.hasOwn(body, 'data')) throw new ApiError('INVALID_RESPONSE');
  return body.data as T;
}
const messages: Record<string, string> = {
  NETWORK_ERROR: 'No pudimos confirmar la operación. Comprueba la conexión y reintenta.',
  FORBIDDEN: 'No tienes permiso para esta operación.',
  AUTH_REQUIRED: 'Tu sesión ha terminado. Vuelve a entrar.',
  VERSION_CONFLICT: 'La tarea cambió. Actualiza el detalle antes de continuar.',
  WORK_REVISION_CONFLICT: 'Cambió la revisión de trabajo. Revisa el contenido actualizado.',
  STALE_CLAIM: 'El claim dejó de ser válido. Actualiza y vuelve a reclamar la tarea.',
  TASK_ALREADY_CLAIMED: 'Otra sesión ya tiene esta tarea.',
  EVIDENCE_REQUIRED: 'Falta evidencia aceptada para esta revisión.',
  CRITERIA_UNMET: 'Hay criterios obligatorios sin evidencia aceptada.',
  DEPENDENCIES_UNMET: 'Hay dependencias sin completar.',
  REVIEW_REQUIRED: 'Falta la aprobación de revisión.',
  QA_REQUIRED: 'Falta la aprobación de QA.',
  HUMAN_APPROVAL_REQUIRED: 'Falta la aprobación humana de cierre.',
  IMPACT_REVIEW_REQUIRED: 'Hay un impacto pendiente de revisión.',
  INVALID_TRANSITION: 'Esta transición no está disponible en el estado actual.',
  CLAIM_REQUIRED: 'Necesitas un claim vigente para esta acción.',
  SESSION_INACTIVE: 'La sesión de trabajo ya no está activa.',
  PROJECT_ARCHIVED: 'El proyecto está archivado.',
  CLAIMS_PAUSED: 'Las reclamaciones están pausadas.',
  VALIDATION_ERROR: 'Revisa los campos: hay datos vacíos o inválidos.',
  CSRF_INVALID: 'La sesión necesita actualizarse. Vuelve a entrar.',
  NO_WORK_CHANGE: 'El resumen no contiene cambios.',
  TASK_NOT_FOUND: 'La tarea no existe en este proyecto.',
  CONTEXT_INCONSISTENT: 'El contexto quedó incompleto. Vuelve a actualizar.',
};
export function message(error: unknown) {
  return error instanceof ApiError
    ? (messages[error.code] ?? `No se pudo completar la operación (${error.code}).`)
    : 'No se pudo cargar la información. Vuelve a intentarlo.';
}
