import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Participants } from './participants.tsx';
import { RequirementSprint } from './iterations.tsx';
import { api } from './api.ts';
import { Modal, Notice, date, useCommand } from './components.tsx';
import { RequirementForm } from './requirement-form.tsx';
import { entities, type DashboardState, type Task, type Member } from './data.ts';
import {
  requirementCatalog,
  type RequirementDetail,
  type RequirementRevision,
} from './requirements-data.ts';

type Action =
  | { kind: 'approve'; requirementVersion: number; revision: number }
  | {
      kind: 'ADD' | 'REMOVE' | 'evaluate';
      requirementVersion: number;
      taskId: string;
      taskVersion: number;
      revision: number | null;
    };
export function RequirementPanel({
  state,
  projectId,
  requirementId,
  principalId,
  csrf,
  roles,
  blocked,
  close,
  openTask,
}: {
  state: DashboardState;
  projectId: string;
  requirementId: string;
  principalId: string;
  csrf: string;
  roles: string[];
  blocked: boolean;
  close: () => void;
  openTask: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ['project', projectId, 'requirement', requirementId, principalId],
    queryFn: ({ signal }) =>
      api<RequirementDetail>(`/projects/${projectId}/requirements/${requirementId}`, { signal }),
    refetchOnWindowFocus: false,
  });
  const command = useCommand(projectId, csrf),
    [tab, setTab] = useState('content'),
    [proposing, setProposing] = useState(false),
    [action, setAction] = useState<Action | null>(null),
    [invalid, setInvalid] = useState('');
  const detail = query.data,
    item = requirementCatalog(state).find((r) => r.id === requirementId),
    tasks = entities<Task>(state, 'TASK'),
    members = entities<Member>(state, 'MEMBER');
  const manages = roles.some((r) => ['OWNER', 'ADMIN', 'MANAGER'].includes(r)),
    writable = manages || roles.includes('REVIEWER');
  const stale = Boolean(detail && (!item || item.version !== detail.version));
  const disabled = blocked || query.isFetching || query.isError || command.isPending || stale;
  const current = detail?.revisions.find((v) => v.revision === detail.revision),
    approved = detail?.revisions.find((v) => v.revision === detail.approvedRevision);
  const actionStale = Boolean(
    action &&
    detail &&
    (action.requirementVersion !== detail.version ||
      (action.kind !== 'approve' &&
        tasks.find((t) => t.id === action.taskId)?.version !== action.taskVersion)),
  );
  const author = (id: string) =>
    id === principalId
      ? 'Tú'
      : (members.find((m) => m.principalId === id)?.agentName ?? `Persona ${id.slice(0, 6)}`);
  function start(kind: 'ADD' | 'REMOVE' | 'evaluate', taskId: string) {
    if (!detail || disabled || !manages) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setInvalid('');
    setAction({
      kind,
      taskId,
      taskVersion: task.version,
      requirementVersion: detail.version,
      revision: detail.approvedRevision,
    });
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !action || disabled || actionStale || !manages) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (action.kind !== 'approve' && !reason) {
      setInvalid('Indica el motivo de esta evaluación o cambio de alcance.');
      return;
    }
    const body =
      action.kind === 'approve'
        ? { expectedVersion: action.requirementVersion, revision: action.revision }
        : {
            expectedVersion: action.requirementVersion,
            taskId: action.taskId,
            taskVersion: action.taskVersion,
            reason,
            ...(action.kind === 'evaluate'
              ? { revision: action.revision }
              : { operation: action.kind }),
          };
    try {
      await command.mutateAsync({
        path: `/projects/${projectId}/requirements/${requirementId}/${action.kind === 'approve' ? 'approve' : action.kind === 'evaluate' ? 'evaluate-impact' : 'link'}`,
        body,
      });
      setAction(null);
      setInvalid('');
    } catch {
      /* Keep entered reason visible for conflict review. */
    }
  }
  return (
    <>
      <Modal
        className="requirement-drawer"
        title={
          detail ? `${detail.publicId} · ${current?.title ?? 'Requisito'}` : 'Detalle de requisito'
        }
        close={close}
      >
        {query.isPending && <p role="status">Cargando requisito e historial…</p>}
        {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
        {detail && !query.isError && (
          <>
            <div className="detail-meta">
              <span className="pill">
                {current?.type === 'FUNCTIONAL' ? 'Funcional' : 'No funcional'}
              </span>
              {current?.status === 'DRAFT' && (
                <span className="pill state-IN_REVIEW">Propuesta r{current.revision}</span>
              )}
              <span className={detail.approvedRevision === null ? 'pill' : 'pill state-DONE'}>
                {detail.approvedRevision === null
                  ? 'Sin revisión aprobada'
                  : `Vigente r${detail.approvedRevision}`}
              </span>
            </div>
            {stale && (
              <p className="notice" role="alert">
                El requisito cambió.{' '}
                <button onClick={() => void query.refetch()}>Actualizar detalle</button>
              </p>
            )}
            {blocked && (
              <p className="notice" role="status">
                Acciones pausadas hasta confirmar datos y permisos actuales.
              </p>
            )}
            {!writable && (
              <p className="muted">Acceso de consulta: contenido e historial disponibles.</p>
            )}
            {command.error && <Notice error={command.error} />}
            {command.isSuccess && (
              <p className="success" role="status">
                Cambio confirmado por el servidor.
              </p>
            )}
            <RequirementSprint
              projectId={projectId}
              requirementId={requirementId}
              version={detail.version}
              sprintId={detail.sprint?.id ?? null}
              csrf={csrf}
              blocked={disabled}
              manages={manages}
            />
            <Participants projectId={projectId} entityId={requirementId} entityType="REQUIREMENT" />
            <div className="requirement-tabs" role="group" aria-label="Secciones del requisito">
              {[
                ['content', 'Contenido'],
                ['tasks', `Tareas · ${detail.links.length}`],
                ['history', 'Historial'],
              ].map(([id, label]) => (
                <button key={id} aria-pressed={tab === id} onClick={() => setTab(id!)}>
                  {label}
                </button>
              ))}
            </div>
            {tab === 'content' && (
              <>
                {current && (
                  <RevisionContent
                    revision={current}
                    label={current.status === 'DRAFT' ? 'Propuesta pendiente' : 'Revisión actual'}
                    author={author}
                  />
                )}
                {approved && approved.revision !== current?.revision && (
                  <RevisionContent
                    revision={approved}
                    label="Alcance aprobado vigente"
                    author={author}
                  />
                )}
                <div className="actions">
                  {writable && (
                    <button disabled={disabled} onClick={() => setProposing(true)}>
                      Proponer nueva revisión
                    </button>
                  )}
                  {manages && current?.status === 'DRAFT' && (
                    <button
                      className="primary"
                      disabled={disabled}
                      onClick={() => {
                        setInvalid('');
                        setAction({
                          kind: 'approve',
                          requirementVersion: detail.version,
                          revision: current.revision,
                        });
                      }}
                    >
                      Revisar y aprobar r{current.revision}
                    </button>
                  )}
                </div>
              </>
            )}
            {tab === 'tasks' && (
              <>
                <p className="muted">
                  Cada vínculo conserva la revisión evaluada. Evaluar este requisito no resuelve
                  impactos de otros requisitos.
                </p>
                {detail.links.length === 0 && <p className="empty">No hay tareas vinculadas.</p>}
                {detail.links.map((link) => {
                  const task = tasks.find((t) => t.id === link.taskId),
                    taskStale = !task || task.version !== link.taskVersion;
                  return (
                    <article className="evidence" key={link.taskId}>
                      <button className="task-link" onClick={() => openTask(link.taskId)}>
                        {link.publicId} · {task?.title ?? 'Abrir tarea'}
                      </button>
                      <p>
                        {link.evaluatedRevision === null
                          ? 'Sin evaluación'
                          : `Evaluada contra r${link.evaluatedRevision}`}{' '}
                        · {link.impactPending ? 'Impacto pendiente' : 'Impacto evaluado'}
                      </p>
                      {task?.status === 'DONE' && (
                        <p className="notice">
                          Tarea completada. Su cierre y validación histórica se conservan.
                        </p>
                      )}
                      {taskStale && (
                        <p className="notice">
                          La tarea cambió. Actualiza el detalle antes de evaluar o retirar el
                          vínculo.
                        </p>
                      )}
                      {manages && (
                        <div className="actions">
                          {link.impactPending && detail.approvedRevision !== null && (
                            <button
                              disabled={disabled || taskStale}
                              onClick={() => start('evaluate', link.taskId)}
                            >
                              Evaluar impacto de {link.publicId}
                            </button>
                          )}
                          <button
                            disabled={disabled || taskStale}
                            onClick={() => start('REMOVE', link.taskId)}
                          >
                            Retirar vínculo de {link.publicId}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
                {manages && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      start('ADD', String(new FormData(e.currentTarget).get('taskId')));
                    }}
                  >
                    <fieldset disabled={disabled}>
                      <label>
                        Vincular tarea
                        <select name="taskId" required defaultValue="">
                          <option value="" disabled>
                            Seleccionar tarea del proyecto
                          </option>
                          {tasks
                            .filter((t) => !detail.links.some((l) => l.taskId === t.id))
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.publicId} · {t.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button type="submit">Revisar vínculo</button>
                    </fieldset>
                  </form>
                )}
              </>
            )}
            {tab === 'history' && (
              <>
                <h3>Revisiones del requisito</h3>
                {[...detail.revisions].reverse().map((v) => (
                  <RevisionContent
                    key={v.revision}
                    revision={v}
                    label={
                      v.status === 'DRAFT'
                        ? 'Propuesta'
                        : v.status === 'APPROVED'
                          ? 'Aprobada vigente'
                          : 'Revisión anterior'
                    }
                    author={author}
                  />
                ))}
                <h3>Evaluaciones de impacto</h3>
                {detail.impactReviews.length === 0 ? (
                  <p className="muted">Todavía no hay evaluaciones.</p>
                ) : (
                  detail.impactReviews.map((review) => (
                    <article className="evidence" key={review.id}>
                      <b>
                        r{review.revision} ·{' '}
                        {tasks.find((t) => t.id === review.taskId)?.publicId ?? 'Tarea'}
                      </b>
                      <p className="summary">{review.reason}</p>
                      <small>
                        {author(review.principalId)} · {date(review.createdAt)}
                      </small>
                    </article>
                  ))
                )}
              </>
            )}
            {action && (
              <section className="requirement-confirm" aria-label="Confirmar cambio de requisito">
                <h3>
                  {action.kind === 'approve'
                    ? `Aprobar revisión ${action.revision}`
                    : action.kind === 'evaluate'
                      ? 'Evaluar impacto'
                      : action.kind === 'ADD'
                        ? 'Vincular tarea'
                        : 'Retirar vínculo'}
                </h3>
                {action.kind === 'approve' ? (
                  <>
                    <p>
                      Vas a aprobar este contenido exacto. La revisión anterior se conserva en el
                      historial.
                    </p>
                    <p className="summary">
                      {detail.revisions.find((v) => v.revision === action.revision)?.description}
                    </p>
                    <p className="notice">
                      {detail.links.length} tareas vinculadas necesitarán evaluar el impacto. Las
                      completadas no se reabren automáticamente.
                    </p>
                  </>
                ) : (
                  <p>
                    {tasks.find((t) => t.id === action.taskId)?.publicId} ·{' '}
                    {action.kind === 'evaluate'
                      ? `Evaluar contra la revisión aprobada r${action.revision}.`
                      : 'Este cambio conserva la auditoría y las evaluaciones anteriores.'}
                  </p>
                )}
                {actionStale && (
                  <p className="notice error" role="alert">
                    Cambió el requisito o la tarea. Cancela esta confirmación y revisa sus versiones
                    actuales. Tu motivo permanece visible.
                  </p>
                )}
                {invalid && (
                  <p className="notice error" role="alert">
                    {invalid}
                  </p>
                )}
                <form onSubmit={(event) => void confirm(event)}>
                  <fieldset disabled={disabled || actionStale}>
                    {action.kind !== 'approve' && (
                      <label>
                        Motivo
                        <textarea name="reason" rows={3} maxLength={4000} required />
                      </label>
                    )}
                    <div className="actions">
                      <button type="submit" className="primary">
                        {command.isPending
                          ? 'Confirmando…'
                          : action.kind === 'approve'
                            ? `Confirmar aprobación r${action.revision}`
                            : 'Confirmar cambio'}
                      </button>
                    </div>
                  </fieldset>
                  <button
                    type="button"
                    disabled={command.isPending}
                    onClick={() => setAction(null)}
                  >
                    Cancelar confirmación
                  </button>
                </form>
              </section>
            )}
          </>
        )}
      </Modal>
      {proposing && current && detail && (
        <RequirementForm
          projectId={projectId}
          csrf={csrf}
          blocked={disabled || !writable}
          revision={current}
          requirementId={requirementId}
          version={item?.version ?? detail.version}
          close={() => setProposing(false)}
          saved={() => setProposing(false)}
        />
      )}
    </>
  );
}
function RevisionContent({
  revision: v,
  label,
  author,
}: {
  revision: RequirementRevision;
  label: string;
  author: (id: string) => string;
}) {
  return (
    <article className="requirement-content">
      <h3>
        {label} · r{v.revision}
      </h3>
      <b>{v.title}</b>
      <p className="summary">{v.description}</p>
      <p>
        <b>Motivo:</b> {v.reason === 'Initial proposal' ? 'Propuesta inicial' : v.reason}
      </p>
      <small className="muted">
        {author(v.createdBy)} · {date(v.createdAt)}
        {v.approvedBy &&
          ` · Aprobada por ${author(v.approvedBy)}${v.approvedAt ? ` el ${date(v.approvedAt)}` : ''}`}
      </small>
    </article>
  );
}
