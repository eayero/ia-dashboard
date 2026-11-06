import { Fragment, useState } from 'react';
import {
  filterRequirements,
  requirementCatalog,
  type RequirementItem,
} from './requirements-data.ts';
import { entities, type DashboardState } from './data.ts';
import { sprintText, type Iteration } from './iterations-data.ts';

export function Requirements({
  state,
  open,
  create,
  writable,
  blocked,
}: {
  state: DashboardState;
  open: (id: string) => void;
  create: () => void;
  writable: boolean;
  blocked: boolean;
}) {
  const [search, setSearch] = useState(''),
    [type, setType] = useState('ALL'),
    [filter, setFilter] = useState('ALL'),
    [sprintFilter, setSprintFilter] = useState('ALL');
  const sprints = entities<Iteration>(state, 'ITERATION');
  const sprintLabel = (id?: string | null) => {
    const i = sprints.find((s) => s.id === id);
    return i ? `${i.publicId} · ${i.name} · ${sprintText[i.status]}` : 'Sin sprint · backlog';
  };
  const catalog = requirementCatalog(state),
    shown = filterRequirements(catalog, search, type, filter)
      .filter(
        (r) =>
          sprintFilter === 'ALL' ||
          (sprintFilter === 'NONE' ? !r.sprintId : r.sprintId === sprintFilter),
      )
      .sort(
        (a, b) =>
          sprintLabel(a.sprintId).localeCompare(sprintLabel(b.sprintId), 'es') ||
          a.publicId.localeCompare(b.publicId, 'es', { numeric: true }),
      );
  return (
    <section className="panel requirements-panel">
      <div className="section-header">
        <div>
          <h2>Catálogo de requisitos</h2>
          <p className="muted">
            {catalog.length} {catalog.length === 1 ? 'requisito' : 'requisitos'} ·{' '}
            {catalog.filter((r) => r.pendingProposal).length}{' '}
            {catalog.filter((r) => r.pendingProposal).length === 1 ? 'propuesta' : 'propuestas'} ·{' '}
            {catalog.reduce((n, r) => n + r.pendingImpacts, 0)}{' '}
            {catalog.reduce((n, r) => n + r.pendingImpacts, 0) === 1
              ? 'impacto pendiente'
              : 'impactos pendientes'}
          </p>
        </div>
        {writable && (
          <button className="primary" disabled={blocked} onClick={create}>
            Proponer requisito
          </button>
        )}
      </div>
      <div className="filters">
        <label>
          Sprint
          <select value={sprintFilter} onChange={(e) => setSprintFilter(e.target.value)}>
            <option value="ALL">Todos los sprints</option>
            <option value="NONE">Sin sprint · backlog</option>
            {sprints.map((i) => (
              <option key={i.id} value={i.id}>
                {i.publicId} · {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Buscar requisito
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Título o identificador"
          />
        </label>
        <label>
          Tipo
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ALL">Todos los tipos</option>
            <option value="FUNCTIONAL">Funcional</option>
            <option value="NON_FUNCTIONAL">No funcional</option>
          </select>
        </label>
        <label>
          Revisión o impacto
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">Todos los requisitos</option>
            <option value="PROPOSAL">Propuesta pendiente</option>
            <option value="IMPACT">Impacto pendiente</option>
          </select>
        </label>
      </div>
      {!writable && (
        <p className="muted">Acceso de consulta. Puedes leer requisitos e historial.</p>
      )}
      {shown.length === 0 ? (
        <div className="empty">
          <h3>
            {catalog.length ? 'Sin requisitos para esta selección' : 'Todavía no hay requisitos'}
          </h3>
          <p>
            {catalog.length
              ? 'Prueba otro filtro o término de búsqueda.'
              : 'Define el alcance y conserva cada revisión aprobada.'}
          </p>
          {!catalog.length && writable && (
            <button disabled={blocked} onClick={create}>
              Proponer primer requisito
            </button>
          )}
        </div>
      ) : (
        <div
          className="table-scroll"
          role="region"
          aria-label="Tabla de requisitos, desplazable horizontalmente"
          tabIndex={0}
        >
          <table>
            <caption className="sr-only">
              Requisitos, propuesta, revisión aprobada e impacto
            </caption>
            <thead>
              <tr>
                <th scope="col">Requisito</th>
                <th scope="col">Tipo</th>
                <th scope="col">Revisiones</th>
                <th scope="col">Impacto</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, index) => (
                <Fragment key={r.id}>
                  {(index === 0 || shown[index - 1]?.sprintId !== r.sprintId) && (
                    <tr className="sprint-group">
                      <th scope="rowgroup" colSpan={4}>
                        {sprintLabel(r.sprintId)}
                      </th>
                    </tr>
                  )}
                  <RequirementRow item={r} open={open} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function RequirementRow({ item: r, open }: { item: RequirementItem; open: (id: string) => void }) {
  return (
    <tr>
      <td>
        <small>{r.publicId}</small>
        <button className="task-link" onClick={() => open(r.id)}>
          {r.current.title}
        </button>
      </td>
      <td>{r.current.type === 'FUNCTIONAL' ? 'Funcional' : 'No funcional'}</td>
      <td>
        {r.pendingProposal && <span className="pill state-IN_REVIEW">Propuesta r{r.revision}</span>}
        <small>
          {r.approvedRevision === null
            ? 'Sin revisión aprobada'
            : `Aprobada r${r.approvedRevision}`}
        </small>
      </td>
      <td>
        {r.pendingImpacts > 0 ? (
          <span className="pill state-BLOCKED">{r.pendingImpacts} pendientes</span>
        ) : (
          <span className="muted">{r.linkedTasks ? 'Evaluado' : 'Sin tareas vinculadas'}</span>
        )}
      </td>
    </tr>
  );
}
