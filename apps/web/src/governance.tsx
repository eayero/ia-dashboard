import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { Modal, Notice, date, useCommand } from './components.tsx';
import {
  governanceStatus,
  priorityText,
  sortQuestions,
  type GovernanceItem,
  type GovernanceKind,
} from './governance-data.ts';
type TaskChoice = { id: string; publicId: string; title: string; version: number };
type LinkedTask = {
  taskId: string;
  publicId: string;
  title: string;
  taskVersion: number;
  hard?: boolean;
  evaluatedRevision?: number | null;
  status: string;
};
type Revision = {
  revision: number;
  title: string;
  context: string;
  alternatives: string[];
  choice: string;
  rationale: string;
  reason: string;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
};
type Answer = {
  id: string;
  text: string;
  createdBy: string;
  createdAt: string;
  creatorIdentity: GovernanceItem['creatorIdentity'];
};
type Detail = GovernanceItem & {
  description?: string;
  acceptedAnswerId?: string | null;
  answers?: Answer[];
  resolutions?: { id: string; action: string; reason: string; createdAt: string }[];
  revisions?: Revision[];
  tasks: LinkedTask[];
  requirements: { id: string; publicId: string }[];
  questions?: { id: string; publicId: string; title: string; status: string }[];
  impactReviews?: {
    id: string;
    taskId: string;
    revision: number;
    reason: string;
    createdAt: string;
  }[];
};
type Props = {
  projectId: string;
  kind: GovernanceKind;
  csrf: string;
  roles: string[];
  blocked: boolean;
  tasks: TaskChoice[];
  requirements: { id: string; publicId: string }[];
  questions: GovernanceItem[];
  inbox?: boolean;
};
export function Governance(props: Props) {
  const {
    projectId,
    kind,
    csrf,
    roles,
    blocked,
    tasks,
    requirements,
    questions,
    inbox = false,
  } = props;
  const [filter, setFilter] = useState(''),
    [priority, setPriority] = useState(''),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<{ base: Detail | null } | null>(null);
  const command = useCommand(projectId, csrf),
    manages = roles.some((r) => ['OWNER', 'ADMIN', 'MANAGER'].includes(r)),
    writable = manages || roles.includes('REVIEWER');
  const query = useQuery({
    queryKey: ['project', projectId, kind, 'list', filter, priority, inbox],
    queryFn: async ({ signal }) => {
      const items: GovernanceItem[] = [];
      let cursor: string | null = null;
      do {
        const q = new URLSearchParams({
          limit: '100',
          ...(cursor ? { cursor } : {}),
          ...(inbox ? { status: 'OPEN' } : filter ? { status: filter } : {}),
          ...(priority && kind === 'questions' ? { priority } : {}),
        });
        const page: { items: GovernanceItem[]; nextCursor: string | null } = await api(
          `/projects/${projectId}/${kind}?${q}`,
          { signal },
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return items;
    },
  });
  const detail = useQuery({
    queryKey: ['project', projectId, kind, selected],
    queryFn: ({ signal }) => api<Detail>(`/projects/${projectId}/${kind}/${selected}`, { signal }),
    enabled: Boolean(selected),
    refetchInterval: selected ? 5000 : false,
  });
  const d = detail.data,
    disabled = blocked || command.isPending || detail.isFetching || detail.isError;
  const shown = (
    kind === 'questions' ? sortQuestions(query.data ?? []) : (query.data ?? [])
  ).filter((i) =>
    `${i.publicId} ${i.title}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  async function act(action: string, body: Record<string, unknown>) {
    if (disabled || !d) return;
    try {
      await command.mutateAsync({
        path: `/projects/${projectId}/${kind}/${d.id}/${action}`,
        body: { expectedVersion: d.version, ...body },
      });
    } catch {
      /* rendered */
    }
  }
  function form(
    e: FormEvent<HTMLFormElement>,
    action: string,
    body: (f: FormData) => Record<string, unknown>,
  ) {
    e.preventDefault();
    void act(action, body(new FormData(e.currentTarget)));
  }
  function link(e: FormEvent<HTMLFormElement>) {
    form(e, 'links', (f) => {
      const task = tasks.find((t) => t.id === f.get('taskId'))!;
      return {
        taskId: task.id,
        taskVersion: task.version,
        operation: f.get('operation'),
        reason: f.get('reason'),
        ...(kind === 'questions' ? { hard: f.get('hard') === 'on' } : {}),
      };
    });
  }
  const heading = inbox
    ? 'Preguntas pendientes'
    : kind === 'questions'
      ? 'Preguntas'
      : 'Decisiones';
  return (
    <section className="panel governance">
      <div className="section-header">
        <div>
          <h2>{heading}</h2>
          <p className="muted">
            {kind === 'questions'
              ? 'Las respuestas propuestas requieren confirmación humana. Leer una pregunta no la resuelve.'
              : 'Las propuestas conservan sus alternativas; solo una aprobación humana cambia la decisión vigente.'}
          </p>
        </div>
        {writable && !inbox && (
          <button
            className="primary"
            disabled={blocked || query.isFetching || query.isError}
            onClick={() => setEditing({ base: null })}
          >
            {kind === 'questions' ? 'Plantear pregunta' : 'Proponer decisión'}
          </button>
        )}
      </div>
      <div className="filters">
        <label>
          Buscar {kind === 'questions' ? 'pregunta' : 'decisión'}
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {!inbox && (
          <label>
            Estado
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Todos los estados</option>
              {(kind === 'questions'
                ? ['OPEN', 'RESOLVED', 'CANCELLED']
                : ['DRAFT', 'APPROVED']
              ).map((s) => (
                <option key={s} value={s}>
                  {governanceStatus[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'questions' && (
          <label>
            Prioridad
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Todas las prioridades</option>
              {Object.entries(priorityText).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {query.isPending && <p role="status">Cargando…</p>}
      {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
      {query.data &&
        !query.error &&
        (shown.length === 0 ? (
          <p className="empty">
            {inbox ? 'No hay preguntas abiertas.' : 'No hay resultados con estos filtros.'}
          </p>
        ) : (
          <div className="table-scroll" role="region" aria-label={heading} tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Referencia / título</th>
                  <th>Estado</th>
                  <th>{kind === 'questions' ? 'Prioridad' : 'Revisión'}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <small>{i.publicId}</small>
                      <button className="task-link" onClick={() => setSelected(i.id)}>
                        {i.title}
                      </button>
                    </td>
                    <td>{governanceStatus[i.status]}</td>
                    <td>
                      {kind === 'questions' ? (
                        <span className={i.priority === 'CRITICAL' ? 'pill state-BLOCKED' : ''}>
                          {priorityText[i.priority ?? 'NORMAL']}
                        </span>
                      ) : (
                        `r${i.revision}${i.approvedRevision ? ` · Vigente r${i.approvedRevision}` : ''}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {selected && !editing && (
        <Modal
          title={
            d
              ? `${d.publicId} · ${d.title ?? d.revisions?.at(-1)?.title ?? ''}`
              : 'Cargando detalle'
          }
          close={() => setSelected(null)}
        >
          {detail.isPending && <p role="status">Cargando detalle…</p>}
          {detail.error && <Notice error={detail.error} retry={() => void detail.refetch()} />}
          {d && !detail.error && (
            <>
              <p className="muted">
                Versión {d.version} · Creado por{' '}
                {d.creatorIdentity?.agentName ??
                  d.creatorIdentity?.username ??
                  d.createdBy.slice(0, 8)}{' '}
                · {date(d.createdAt)}
              </p>
              {command.error && (
                <Notice error={command.error} retry={() => void detail.refetch()} />
              )}
              {writable && (kind === 'decisions' || d.status === 'OPEN') && (
                <button disabled={disabled} onClick={() => setEditing({ base: d })}>
                  {kind === 'questions' ? 'Editar pregunta' : 'Proponer nueva revisión'}
                </button>
              )}
              {kind === 'questions' ? (
                <>
                  <p>
                    <strong>
                      {governanceStatus[d.status]} · {priorityText[d.priority ?? 'NORMAL']}
                    </strong>
                  </p>
                  <p className="governance-text">{d.description}</p>
                  <h3>Respuestas propuestas</h3>
                  {(d.answers ?? []).length === 0 && (
                    <p className="empty">Todavía no hay respuestas.</p>
                  )}
                  {d.answers?.map((a) => (
                    <article className="answer" key={a.id}>
                      <p className="governance-text">{a.text}</p>
                      <small>
                        {a.creatorIdentity?.agentName ??
                          a.creatorIdentity?.username ??
                          a.createdBy.slice(0, 8)}{' '}
                        · {date(a.createdAt)}
                      </small>
                      {d.acceptedAnswerId === a.id ? (
                        <p className="pill state-DONE">Respuesta confirmada</p>
                      ) : (
                        writable &&
                        d.status === 'OPEN' && (
                          <form
                            onSubmit={(e) =>
                              form(e, 'resolve', (f) => ({
                                answerId: a.id,
                                reason: f.get('reason'),
                              }))
                            }
                          >
                            <fieldset disabled={disabled}>
                              <label>
                                Motivo de confirmación
                                <input name="reason" required maxLength={8000} />
                              </label>
                              <button type="submit">Confirmar esta respuesta</button>
                            </fieldset>
                          </form>
                        )
                      )}
                    </article>
                  ))}
                  {writable && d.status === 'OPEN' && (
                    <form onSubmit={(e) => form(e, 'answer', (f) => ({ text: f.get('text') }))}>
                      <fieldset disabled={disabled}>
                        <label>
                          Proponer respuesta
                          <textarea name="text" required maxLength={8000} />
                        </label>
                        <button type="submit">Guardar respuesta</button>
                      </fieldset>
                    </form>
                  )}
                  {manages && (
                    <form
                      onSubmit={(e) =>
                        form(e, 'status', (f) => ({ to: f.get('to'), reason: f.get('reason') }))
                      }
                    >
                      <fieldset disabled={disabled}>
                        <label>
                          Estado de la pregunta
                          <select
                            name="to"
                            defaultValue={d.status === 'OPEN' ? 'CANCELLED' : 'OPEN'}
                          >
                            <option value="OPEN" disabled={d.status === 'OPEN'}>
                              Reabrir
                            </option>
                            <option value="CANCELLED" disabled={d.status === 'CANCELLED'}>
                              Cancelar
                            </option>
                          </select>
                        </label>
                        <label>
                          Motivo del cambio
                          <input name="reason" required maxLength={8000} />
                        </label>
                        <button type="submit">Cambiar estado</button>
                      </fieldset>
                    </form>
                  )}
                  <h3>Historial de resolución</h3>
                  {d.resolutions?.length ? (
                    d.resolutions.map((r) => (
                      <p key={r.id}>
                        {r.action === 'RESOLVE'
                          ? 'Confirmación'
                          : r.action === 'REOPEN'
                            ? 'Reapertura'
                            : 'Cancelación'}{' '}
                        · {r.reason}
                        <small>{date(r.createdAt)}</small>
                      </p>
                    ))
                  ) : (
                    <p className="empty">Sin resoluciones.</p>
                  )}
                </>
              ) : (
                <>
                  <p>
                    Revisión propuesta r{d.revision} ·{' '}
                    {d.approvedRevision
                      ? `Vigente r${d.approvedRevision}`
                      : 'Sin decisión aprobada'}
                  </p>
                  {d.revisions?.map((r) => (
                    <details key={r.revision} open={r.revision === d.revision}>
                      <summary>
                        Revisión {r.revision} · {governanceStatus[r.status]}
                      </summary>
                      <h3>{r.title}</h3>
                      <p className="governance-text">{r.context}</p>
                      <ul>
                        {r.alternatives.map((a) => (
                          <li key={a}>
                            {a === r.choice ? '✓ ' : ''}
                            {a}
                          </li>
                        ))}
                      </ul>
                      <p>
                        <strong>Elección: {r.choice}</strong>
                      </p>
                      <p className="governance-text">{r.rationale}</p>
                      {r.approvedAt && <small>Aprobación humana: {date(r.approvedAt)}</small>}
                    </details>
                  ))}
                  {manages && d.revisions?.at(-1)?.status === 'DRAFT' && (
                    <form
                      onSubmit={(e) =>
                        form(e, 'approve', (f) => ({
                          revision: d.revision,
                          reason: f.get('reason'),
                        }))
                      }
                    >
                      <fieldset disabled={disabled}>
                        <label>
                          Motivo de aprobación
                          <textarea name="reason" required maxLength={8000} />
                        </label>
                        <button type="submit">Aprobar revisión {d.revision}</button>
                      </fieldset>
                      <p className="muted">
                        La nueva revisión requerirá evaluar impacto en sus tareas. Las completadas
                        conservan su estado.
                      </p>
                    </form>
                  )}
                  {d.questions?.length ? (
                    <>
                      <h3>Preguntas relacionadas</h3>
                      <ul>
                        {d.questions.map((q) => (
                          <li key={q.id}>
                            {q.publicId} · {q.title} · {governanceStatus[q.status]}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </>
              )}
              <h3>Tareas vinculadas</h3>
              {d.tasks.length === 0 ? (
                <p className="empty">Sin tareas vinculadas.</p>
              ) : (
                <ul className="criteria">
                  {d.tasks.map((t) => (
                    <li key={t.taskId}>
                      <span>
                        {t.publicId} · {t.title}
                      </span>
                      <small>
                        {kind === 'questions'
                          ? t.hard
                            ? 'Bloqueo duro'
                            : 'Informativo'
                          : d.approvedRevision && t.evaluatedRevision !== d.approvedRevision
                            ? 'Impacto pendiente'
                            : t.evaluatedRevision
                              ? `Evaluada r${t.evaluatedRevision}`
                              : 'Sin revisión aprobada'}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
              {manages && tasks.length > 0 && (
                <form onSubmit={link}>
                  <fieldset disabled={disabled}>
                    <label>
                      Tarea
                      <select name="taskId" required>
                        {tasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.publicId} · {t.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Operación
                      <select name="operation">
                        <option value="ADD">Añadir o actualizar vínculo</option>
                        <option value="REMOVE">Retirar vínculo</option>
                      </select>
                    </label>
                    {kind === 'questions' && (
                      <label>
                        <input type="checkbox" name="hard" />
                        Bloquear la tarea mientras la pregunta esté abierta
                      </label>
                    )}
                    <label>
                      Motivo del vínculo
                      <input name="reason" required maxLength={8000} />
                    </label>
                    <button type="submit">Guardar vínculo</button>
                  </fieldset>
                </form>
              )}
              {kind === 'decisions' &&
                manages &&
                Boolean(d.approvedRevision) &&
                d.tasks.length > 0 && (
                  <form
                    onSubmit={(e) =>
                      form(e, 'evaluate-impact', (f) => {
                        const t = d.tasks.find((t) => t.taskId === f.get('taskId'))!;
                        return {
                          taskId: t.taskId,
                          taskVersion: t.taskVersion,
                          revision: d.approvedRevision,
                          reason: f.get('reason'),
                        };
                      })
                    }
                  >
                    <fieldset disabled={disabled}>
                      <label>
                        Tarea para evaluar impacto
                        <select name="taskId">
                          {d.tasks.map((t) => (
                            <option key={t.taskId} value={t.taskId}>
                              {t.publicId} · {t.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Evaluación del impacto
                        <textarea name="reason" required maxLength={8000} />
                      </label>
                      <button type="submit">
                        Confirmar evaluación de impacto r{d.approvedRevision}
                      </button>
                    </fieldset>
                  </form>
                )}
              {kind === 'decisions' && (
                <>
                  <h3>Historial de impacto</h3>
                  {d.impactReviews?.length ? (
                    d.impactReviews.map((r) => (
                      <p key={r.id}>
                        r{r.revision} · {r.reason}
                        <small>{date(r.createdAt)}</small>
                      </p>
                    ))
                  ) : (
                    <p className="empty">Sin evaluaciones registradas.</p>
                  )}
                </>
              )}
              {d.requirements.length > 0 && (
                <>
                  <h3>Requisitos relacionados</h3>
                  <p>{d.requirements.map((r) => r.publicId).join(', ')}</p>
                </>
              )}
              {!writable && (
                <p className="notice">
                  Acceso de consulta: tus permisos permiten leer este historial.
                </p>
              )}
            </>
          )}
        </Modal>
      )}
      {editing && (
        <GovernanceForm
          key={editing.base ? `${editing.base.id}-${editing.base.version}` : 'new'}
          projectId={projectId}
          kind={kind}
          base={editing.base}
          csrf={csrf}
          blocked={
            blocked ||
            !writable ||
            Boolean(editing.base && detail.data && editing.base.version !== detail.data.version)
          }
          tasks={tasks}
          requirements={requirements}
          questions={questions}
          close={() => setEditing(null)}
          saved={(id) => {
            setEditing(null);
            setSelected(id);
          }}
        />
      )}
    </section>
  );
}
function GovernanceForm({
  projectId,
  kind,
  base,
  csrf,
  blocked,
  tasks,
  requirements,
  questions,
  close,
  saved,
}: {
  projectId: string;
  kind: GovernanceKind;
  base: Detail | null;
  csrf: string;
  blocked: boolean;
  tasks: TaskChoice[];
  requirements: { id: string; publicId: string }[];
  questions: GovernanceItem[];
  close: () => void;
  saved: (id: string) => void;
}) {
  const current = base?.revisions?.at(-1),
    [alternatives, setAlternatives] = useState(current?.alternatives.join('\n') ?? '');
  const command = useCommand(projectId, csrf),
    disabled = blocked || command.isPending;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;
    const f = new FormData(e.currentTarget);
    try {
      const body = {
        title: f.get('title'),
        ...(kind === 'questions'
          ? { description: f.get('description'), priority: f.get('priority') }
          : {
              context: f.get('context'),
              alternatives: alternatives
                .split('\n')
                .map((v) => v.trim())
                .filter(Boolean),
              choice: f.get('choice'),
              rationale: f.get('rationale'),
            }),
        ...(base
          ? { expectedVersion: base.version, reason: f.get('reason') }
          : {
              taskIds: f.getAll('taskIds'),
              requirementIds: f.getAll('requirementIds'),
              ...(kind === 'decisions' ? { questionIds: f.getAll('questionIds') } : {}),
            }),
      };
      const result = await command.mutateAsync({
        path: `/projects/${projectId}/${kind}${base ? `/${base.id}/revise` : ''}`,
        body,
      });
      saved(String(result.id));
    } catch {
      /* rendered */
    }
  }
  return (
    <Modal
      title={
        kind === 'questions'
          ? base
            ? 'Editar pregunta'
            : 'Plantear pregunta'
          : base
            ? 'Proponer nueva revisión'
            : 'Proponer decisión'
      }
      close={close}
    >
      <form onSubmit={save}>
        <fieldset disabled={disabled}>
          <label>
            Título
            <input
              name="title"
              required
              maxLength={300}
              defaultValue={base?.title ?? current?.title ?? ''}
              autoFocus
            />
          </label>
          {kind === 'questions' ? (
            <>
              <label>
                Descripción
                <textarea
                  name="description"
                  required
                  maxLength={8000}
                  defaultValue={base?.description ?? ''}
                />
              </label>
              <label>
                Prioridad
                <select name="priority" defaultValue={base?.priority ?? 'NORMAL'}>
                  {Object.entries(priorityText).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                Contexto
                <textarea
                  name="context"
                  required
                  maxLength={8000}
                  defaultValue={current?.context ?? ''}
                />
              </label>
              <label>
                Alternativas, una por línea
                <textarea
                  name="alternatives"
                  required
                  value={alternatives}
                  onChange={(e) => setAlternatives(e.target.value)}
                />
              </label>
              <label>
                Elección propuesta
                <select name="choice" required defaultValue={current?.choice ?? ''}>
                  <option value="" disabled>
                    Seleccionar alternativa
                  </option>
                  {[
                    ...new Set(
                      alternatives
                        .split('\n')
                        .map((v) => v.trim())
                        .filter(Boolean),
                    ),
                  ].map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label>
                Justificación
                <textarea
                  name="rationale"
                  required
                  maxLength={8000}
                  defaultValue={current?.rationale ?? ''}
                />
              </label>
            </>
          )}
          {base ? (
            <label>
              Motivo de la revisión
              <textarea name="reason" required maxLength={8000} />
            </label>
          ) : (
            <>
              <label>
                Requisitos relacionados
                <select name="requirementIds" multiple>
                  {requirements.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.publicId}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tareas informativas
                <select name="taskIds" multiple>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.publicId} · {t.title}
                    </option>
                  ))}
                </select>
              </label>
              {kind === 'decisions' && (
                <label>
                  Preguntas relacionadas
                  <select name="questionIds" multiple>
                    {questions.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.publicId} · {q.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <button className="primary" type="submit">
            {command.isPending
              ? 'Guardando…'
              : base
                ? 'Guardar nueva revisión'
                : 'Guardar propuesta'}
          </button>
        </fieldset>
        {blocked && (
          <p className="notice">
            Los datos o permisos han cambiado. Cierra y actualiza el detalle antes de guardar.
          </p>
        )}
        {command.error && <Notice error={command.error} />}
      </form>
    </Modal>
  );
}
