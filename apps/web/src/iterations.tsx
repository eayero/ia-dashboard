import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { Modal, Notice, useCommand } from './components.tsx';
import { sprintText, type Iteration } from './iterations-data.ts';
export function useIterations(projectId: string) {
  return useQuery({
    queryKey: ['project', projectId, 'iterations'],
    queryFn: async ({ signal }) => {
      const items: Iteration[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: Iteration[]; nextCursor: string | null } = await api(
          `/projects/${projectId}/iterations?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
          { signal },
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return items;
    },
  });
}
export function Iterations({
  projectId,
  csrf,
  manages,
  blocked,
}: {
  projectId: string;
  csrf: string;
  manages: boolean;
  blocked: boolean;
}) {
  const query = useIterations(projectId),
    command = useCommand(projectId, csrf);
  const [editing, setEditing] = useState<Iteration | 'new' | null>(null),
    [transition, setTransition] = useState<{ sprint: Iteration; to: string } | null>(null);
  const disabled = blocked || query.isFetching || query.isError || command.isPending;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled || !editing) return;
    const f = new FormData(e.currentTarget);
    try {
      await command.mutateAsync({
        path: `/projects/${projectId}/iterations${editing === 'new' ? '' : `/${editing.id}/update`}`,
        body: {
          name: f.get('name'),
          goal: f.get('goal'),
          startsOn: f.get('startsOn'),
          endsOn: f.get('endsOn'),
          ...(editing === 'new'
            ? {}
            : { expectedVersion: editing.version, reason: f.get('reason') }),
        },
      });
      setEditing(null);
    } catch {
      /* rendered */
    }
  }
  async function move(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled || !transition) return;
    const f = new FormData(e.currentTarget);
    try {
      await command.mutateAsync({
        path: `/projects/${projectId}/iterations/${transition.sprint.id}/transition`,
        body: {
          expectedVersion: transition.sprint.version,
          to: transition.to,
          reason: f.get('reason'),
        },
      });
      setTransition(null);
    } catch {
      /* rendered */
    }
  }
  const choices: Record<string, string[]> = {
    PLANNED: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['PAUSED', 'COMPLETED', 'CANCELLED'],
    PAUSED: ['ACTIVE', 'CANCELLED'],
  };
  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <h2>Sprints</h2>
          <p className="muted">
            Los requisitos agrupan el alcance. Las tareas heredan el sprint de su requisito
            principal.
          </p>
        </div>
        {manages && (
          <button className="primary" disabled={disabled} onClick={() => setEditing('new')}>
            Crear sprint
          </button>
        )}
      </div>
      {query.isPending && <p role="status">Cargando sprints…</p>}
      {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
      {command.error && !editing && !transition && <Notice error={command.error} />}
      {query.data &&
        !query.isError &&
        (query.data.length === 0 ? (
          <p className="empty">Todavía no hay sprints. Crea uno para planificar los requisitos.</p>
        ) : (
          <div className="table-scroll" role="region" aria-label="Sprints y acciones" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Sprint / meta</th>
                  <th>Estado</th>
                  <th>Fechas previstas</th>
                  <th>Alcance</th>
                  {manages && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {query.data.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>
                        {i.publicId} · {i.name}
                      </strong>
                      <small>{i.goal}</small>
                    </td>
                    <td>
                      <span
                        className={`pill state-${i.status === 'ACTIVE' ? 'IN_PROGRESS' : i.status === 'COMPLETED' ? 'DONE' : 'READY'}`}
                      >
                        {sprintText[i.status]}
                      </span>
                    </td>
                    <td>
                      {i.startsOn}
                      <br />
                      {i.endsOn}
                    </td>
                    <td>
                      {i.requirementCount} requisitos
                      <br />
                      {i.taskCount} tareas · {i.pendingTasks} pendientes
                    </td>
                    {manages && (
                      <td>
                        <div className="actions">
                          {choices[i.status] && (
                            <button disabled={disabled} onClick={() => setEditing(i)}>
                              Editar
                            </button>
                          )}
                          {choices[i.status]?.map((to) => (
                            <button
                              key={to}
                              disabled={
                                disabled ||
                                (to === 'ACTIVE' && query.data.some((s) => s.status === 'ACTIVE'))
                              }
                              onClick={() => setTransition({ sprint: i, to })}
                            >
                              {sprintText[to]}
                            </button>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {editing && (
        <Modal
          title={editing === 'new' ? 'Crear sprint' : 'Editar sprint'}
          close={() => setEditing(null)}
        >
          <form onSubmit={save}>
            <fieldset disabled={disabled}>
              <label>
                Nombre
                <input
                  name="name"
                  required
                  maxLength={300}
                  defaultValue={editing === 'new' ? '' : editing.name}
                  autoFocus
                />
              </label>
              <label>
                Meta
                <textarea
                  name="goal"
                  required
                  maxLength={4000}
                  defaultValue={editing === 'new' ? '' : editing.goal}
                />
              </label>
              <label>
                Inicio previsto
                <input
                  name="startsOn"
                  type="date"
                  required
                  defaultValue={editing === 'new' ? '' : editing.startsOn}
                />
              </label>
              <label>
                Fin previsto
                <input
                  name="endsOn"
                  type="date"
                  required
                  defaultValue={editing === 'new' ? '' : editing.endsOn}
                />
              </label>
              {editing !== 'new' && (
                <label>
                  Motivo
                  <textarea name="reason" required maxLength={4000} />
                </label>
              )}
              <button className="primary" type="submit">
                {command.isPending ? 'Guardando…' : 'Guardar sprint'}
              </button>
            </fieldset>
            {command.error && <Notice error={command.error} />}
          </form>
        </Modal>
      )}
      {transition && (
        <Modal
          title={`${sprintText[transition.to]} · ${transition.sprint.name}`}
          close={() => setTransition(null)}
        >
          <p>
            {transition.sprint.pendingTasks} tareas pendientes.{' '}
            {transition.sprint.status === 'ACTIVE'
              ? 'Al detener el sprint se cerrarán los contadores y se liberarán los claims.'
              : ''}
          </p>
          <form onSubmit={move}>
            <fieldset disabled={disabled}>
              <label>
                Motivo
                <textarea name="reason" required maxLength={4000} autoFocus />
              </label>
              <button className="primary" type="submit">
                {command.isPending ? 'Confirmando…' : 'Confirmar cambio'}
              </button>
            </fieldset>
            {command.error && <Notice error={command.error} />}
          </form>
        </Modal>
      )}
    </section>
  );
}
export function RequirementSprint({
  projectId,
  requirementId,
  version,
  sprintId,
  csrf,
  blocked,
  manages,
}: {
  projectId: string;
  requirementId: string;
  version: number;
  sprintId: string | null;
  csrf: string;
  blocked: boolean;
  manages: boolean;
}) {
  const query = useIterations(projectId),
    command = useCommand(projectId, csrf);
  const [editing, setEditing] = useState(false);
  const current = query.data?.find((i) => i.id === sprintId);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked || query.isFetching || query.isError || command.isPending) return;
    const f = new FormData(e.currentTarget);
    try {
      await command.mutateAsync({
        path: `/projects/${projectId}/requirements/${requirementId}/sprint`,
        body: {
          expectedVersion: version,
          sprintId: f.get('sprintId') || null,
          reason: f.get('reason'),
        },
      });
      setEditing(false);
    } catch {
      /* rendered */
    }
  }
  return (
    <section>
      <h3>Sprint del requisito</h3>
      <p>
        {current
          ? `${current.publicId} · ${current.name} · ${sprintText[current.status]}`
          : sprintId
            ? 'Cargando sprint…'
            : 'Sin sprint · backlog'}
      </p>
      {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
      {manages && (
        <button
          disabled={blocked || query.isFetching || query.isError}
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Cancelar cambio' : 'Asignar o cambiar sprint'}
        </button>
      )}
      {editing && (
        <form onSubmit={save}>
          <fieldset disabled={blocked || query.isFetching || query.isError || command.isPending}>
            <label>
              Sprint
              <select name="sprintId" defaultValue={sprintId ?? ''}>
                <option value="">Sin sprint · backlog</option>
                {query.data
                  ?.filter(
                    (i) => !['COMPLETED', 'CANCELLED'].includes(i.status) || i.id === sprintId,
                  )
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.publicId} · {i.name} · {sprintText[i.status]}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Motivo
              <textarea name="reason" required maxLength={4000} />
            </label>
            <p className="muted">
              Las tareas principales heredarán el nuevo sprint. Primero pausa el trabajo y libera
              los claims.
            </p>
            <button type="submit">Guardar asignación</button>
          </fieldset>
          {command.error && <Notice error={command.error} />}
        </form>
      )}
    </section>
  );
}
