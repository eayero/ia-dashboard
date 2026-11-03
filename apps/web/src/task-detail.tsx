import { useQuery } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { api } from './api.ts';
import type { TaskDetail, Session } from './data.ts';
import { Modal, Notice, Status, date, useCommand } from './components.tsx';

export function TaskPanel({
  projectId,
  taskId,
  principalId,
  csrf,
  roles,
  sessions,
  currentVersion,
  blocked,
  close,
}: {
  projectId: string;
  taskId: string;
  principalId: string;
  csrf: string;
  roles: string[];
  sessions: Session[];
  currentVersion?: number;
  blocked: boolean;
  close: () => void;
}) {
  const query = useQuery({
    queryKey: ['project', projectId, 'task', taskId, principalId],
    queryFn: ({ signal }) => api<TaskDetail>(`/projects/${projectId}/tasks/${taskId}`, { signal }),
    refetchOnWindowFocus: false,
  });
  const command = useCommand(projectId, csrf);
  const task = query.data;
  const manages = roles.some((role) => ['OWNER', 'ADMIN', 'MANAGER'].includes(role));
  const reviews = roles.some((role) => ['OWNER', 'ADMIN', 'REVIEWER'].includes(role));
  const writable = manages || reviews;
  const stale = Boolean(task && currentVersion !== undefined && currentVersion !== task.version);
  const disabled = blocked || query.isFetching || query.isError || command.isPending || stale;
  const ownSession = sessions.find(
    (s) =>
      s.principalId === principalId && !s.endedAt && new Date(s.expiresAt).getTime() > Date.now(),
  );
  const owned =
    task?.claim?.principalId === principalId &&
    task.claim.fencingToken &&
    new Date(task.claim.expiresAt).getTime() > Date.now();
  const claim = owned
    ? { sessionId: task!.claim!.sessionId, fencingToken: task!.claim!.fencingToken }
    : {};
  const approved = (kind: string) =>
    task?.approvals.some(
      (a) => a.kind === kind && a.workRevision === task.workRevision && !a.invalidatedAt,
    );
  async function act(name: string, payload: Record<string, unknown> = {}) {
    if (!task || disabled) return;
    try {
      await command.mutateAsync({
        path: `/projects/${projectId}/tasks/${taskId}/${name}`,
        body: { expectedVersion: task.version, ...payload },
      });
    } catch {
      /* Rendered below. */
    }
  }
  function form(
    event: FormEvent<HTMLFormElement>,
    name: string,
    payload: (form: FormData) => Record<string, unknown>,
  ) {
    event.preventDefault();
    void act(name, payload(new FormData(event.currentTarget)));
  }
  return (
    <Modal title={task ? `${task.publicId} · ${task.title}` : 'Detalle de tarea'} close={close}>
      {query.isPending && <p role="status">Cargando detalle…</p>}
      {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
      {task && !query.isError && (
        <>
          <div className="detail-meta">
            <Status status={task.status} />
            <span>
              Versión {task.version} · Revisión {task.workRevision}
            </span>
            <span>{task.workType === 'CODE' ? 'Código' : 'Trabajo general'}</span>
          </div>
          {stale && (
            <div className="notice" role="status">
              La tarea cambió. Revisa la nueva versión antes de actuar.{' '}
              <button onClick={() => void query.refetch()}>Actualizar detalle</button>
            </div>
          )}
          {blocked && (
            <p className="notice" role="status">
              Acciones pausadas hasta confirmar datos y permisos actuales.
            </p>
          )}
          {command.error && <Notice error={command.error} />}
          {command.isSuccess && (
            <p className="success" role="status">
              Cambio confirmado por el servidor.
            </p>
          )}
          <h3>Criterios de aceptación</h3>
          <ul className="criteria">
            {task.criteria.map((c) => (
              <li key={c.id}>
                <b>{c.id}</b> {c.description}
                {c.required && <span className="muted"> · obligatorio</span>}
              </li>
            ))}
          </ul>
          {task.impactPending && <p className="notice">Hay impacto pendiente de revisión.</p>}
          {task.dependencies.length > 0 && (
            <>
              <h3>Dependencias</h3>
              <ul>
                {task.dependencies.map((d) => (
                  <li key={d.id}>
                    {d.publicId} · <Status status={d.status} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Implementación</h3>
          <p className="summary">{task.summary || 'Todavía no hay resumen de implementación.'}</p>
          <h3>Evidencias</h3>
          {task.evidence.length === 0 ? (
            <p className="muted">No se han adjuntado evidencias.</p>
          ) : (
            task.evidence.map((e) => (
              <article key={e.id} className="evidence">
                <div>
                  <b>{e.kind}</b> · Revisión {e.workRevision} ·{' '}
                  {e.acceptedBy ? 'Aceptada por una persona' : 'Declarada, pendiente de aceptación'}
                </div>
                <a href={e.url} target="_blank" rel="noopener noreferrer">
                  Abrir evidencia ↗
                </a>
                {e.commit && <code>{e.commit}</code>}
                {reviews &&
                  !e.acceptedBy &&
                  e.workRevision === task.workRevision &&
                  !['DONE', 'CANCELLED'].includes(task.status) && (
                    <button
                      disabled={disabled}
                      onClick={() => void act('accept-evidence', { evidenceId: e.id })}
                    >
                      Aceptar evidencia
                    </button>
                  )}
              </article>
            ))
          )}
          <h3>Aprobaciones de esta revisión</h3>
          <div className="approval-list">
            {(['REVIEW', 'QA', 'CLOSURE'] as const).map((kind, i) => (
              <span key={kind} className={approved(kind) ? 'success' : 'muted'}>
                {['Revisión', 'QA', 'Cierre'][i]}: {approved(kind) ? 'aprobada' : 'pendiente'}
              </span>
            ))}
          </div>
          {writable && (
            <section className="work-actions">
              <h3>Acciones de tarea</h3>
              <div className="actions">
                {manages && ['BACKLOG', 'BLOCKED'].includes(task.status) && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => void act('transition', { to: 'READY' })}
                  >
                    Marcar lista
                  </button>
                )}
                {['READY', 'IN_PROGRESS'].includes(task.status) && !task.claim && (
                  <button
                    disabled={disabled || !ownSession}
                    onClick={() => void act('claim', { sessionId: ownSession!.id })}
                  >
                    Reclamar tarea
                  </button>
                )}
                {owned && (
                  <>
                    <button disabled={disabled} onClick={() => void act('heartbeat', claim)}>
                      Renovar claim
                    </button>
                    <button disabled={disabled} onClick={() => void act('release', claim)}>
                      Liberar tarea
                    </button>
                  </>
                )}
                {owned && task.status === 'IN_PROGRESS' && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => void act('transition', { ...claim, to: 'IN_REVIEW' })}
                  >
                    Enviar a revisión
                  </button>
                )}
                {reviews && task.status === 'IN_REVIEW' && !approved('REVIEW') && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() =>
                      void act('approve', { kind: 'REVIEW', workRevision: task.workRevision })
                    }
                  >
                    Aprobar revisión
                  </button>
                )}
                {reviews && task.status === 'IN_REVIEW' && approved('REVIEW') && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => void act('transition', { to: 'IN_QA' })}
                  >
                    Pasar a QA
                  </button>
                )}
                {reviews && task.status === 'IN_QA' && !approved('QA') && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() =>
                      void act('approve', { kind: 'QA', workRevision: task.workRevision })
                    }
                  >
                    Aprobar QA
                  </button>
                )}
                {reviews && task.status === 'IN_QA' && !approved('CLOSURE') && (
                  <button
                    disabled={disabled || !approved('QA')}
                    onClick={() =>
                      void act('approve', { kind: 'CLOSURE', workRevision: task.workRevision })
                    }
                  >
                    Aprobar cierre
                  </button>
                )}
                {reviews && task.status === 'IN_QA' && approved('QA') && approved('CLOSURE') && (
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => void act('transition', { to: 'DONE' })}
                  >
                    Completar tarea
                  </button>
                )}
                <button
                  disabled={query.isFetching || command.isPending}
                  onClick={() => void query.refetch()}
                >
                  Actualizar detalle
                </button>
              </div>
              {!ownSession && ['READY', 'IN_PROGRESS'].includes(task.status) && (
                <p className="muted">
                  Inicia una sesión de trabajo desde «Sesiones» antes de reclamar.
                </p>
              )}
              {task.claim && (
                <p className="muted">
                  {owned ? 'Tu sesión tiene el claim' : 'Claim de otra sesión'} · vence{' '}
                  {date(task.claim.expiresAt)}
                </p>
              )}
              {owned && task.status === 'IN_PROGRESS' && (
                <form
                  key={`summary-${task.version}`}
                  onSubmit={(event) =>
                    form(event, 'work', (data) => ({ ...claim, summary: data.get('summary') }))
                  }
                >
                  <fieldset disabled={disabled}>
                    <label>
                      Resumen de implementación
                      <textarea
                        name="summary"
                        required
                        maxLength={4000}
                        rows={3}
                        defaultValue={task.summary}
                      />
                    </label>
                    <button type="submit">Guardar implementación</button>
                  </fieldset>
                </form>
              )}
              {((owned && task.status === 'IN_PROGRESS') ||
                ['IN_REVIEW', 'IN_QA'].includes(task.status)) && (
                <form
                  key={`evidence-${task.version}`}
                  onSubmit={(event) =>
                    form(event, 'evidence', (data) => ({
                      ...(owned ? claim : {}),
                      kind: task.status === 'IN_PROGRESS' ? 'OTHER' : 'REVIEW',
                      url: data.get('url'),
                      criterionIds: data.getAll('criteria'),
                    }))
                  }
                >
                  <fieldset disabled={disabled}>
                    <label>
                      URL HTTPS del informe
                      <input name="url" type="url" pattern="https://.*" required maxLength={4000} />
                    </label>
                    <div className="checks">
                      {task.criteria.map((c) => (
                        <label key={c.id}>
                          <input name="criteria" type="checkbox" value={c.id} defaultChecked />
                          {c.id}
                        </label>
                      ))}
                    </div>
                    <button type="submit">Adjuntar informe</button>
                  </fieldset>
                  <p className="muted">
                    La evidencia de código y pruebas estructuradas se registra mediante API/MCP.
                  </p>
                </form>
              )}
              {reviews && ['IN_REVIEW', 'IN_QA'].includes(task.status) && (
                <form
                  onSubmit={(event) =>
                    form(event, 'transition', (data) => ({
                      to: 'IN_PROGRESS',
                      reason: data.get('reason'),
                    }))
                  }
                >
                  <fieldset disabled={disabled}>
                    <label>
                      Motivo de devolución
                      <input name="reason" required maxLength={4000} />
                    </label>
                    <button type="submit">Devolver a implementación</button>
                  </fieldset>
                </form>
              )}
            </section>
          )}
          {!writable && (
            <p className="notice">
              Acceso de consulta: no tienes permisos para modificar esta tarea.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
