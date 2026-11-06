import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { Notice, date } from './components.tsx';
import { formatWorkDuration } from './work-time.ts';
type Identity = {
  principalId: string;
  kind: string;
  agentName?: string | null;
  username?: string | null;
  ownerUsername?: string | null;
  ownerUserId?: string | null;
};
type Person = {
  principalId: string;
  identity: Identity | null;
  firstAt: string | null;
  lastAt: string | null;
  actionCount: number;
  channels: string[];
  milliseconds: string;
};
type Attribution = {
  creator: { principalId: string; identity: Identity | null; createdAt: string; channel: string };
  participants: Person[];
  taskCollaborators: Person[];
  totalMilliseconds: string;
  owners: { ownerUserId: string; milliseconds: string }[];
};
function label(identity: Identity | null, id: string) {
  return identity?.agentName ?? identity?.username ?? `Identidad ${id.slice(0, 8)}`;
}
export function Participants({
  projectId,
  entityId,
  entityType,
}: {
  projectId: string;
  entityId: string;
  entityType: 'TASK' | 'REQUIREMENT';
}) {
  const query = useQuery({
    queryKey: ['project', projectId, 'participants', entityType, entityId],
    queryFn: ({ signal }) =>
      api<Attribution>(
        `/projects/${projectId}/participants?entityType=${entityType}&entityId=${entityId}`,
        { signal },
      ),
    refetchInterval: 5000,
  });
  return (
    <section className="participants">
      <h3>Autoría y participantes</h3>
      {query.isPending && <p role="status">Cargando participantes…</p>}
      {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
      {query.data && !query.isError && (
        <>
          <p>
            Creado por{' '}
            <strong>{label(query.data.creator.identity, query.data.creator.principalId)}</strong>
            {query.data.creator.identity?.kind === 'AGENT' && (
              <>
                {' '}
                · Usuario:{' '}
                {query.data.creator.identity.ownerUsername ??
                  query.data.creator.identity.ownerUserId ??
                  'no registrado'}
              </>
            )}
            <br />
            <small>
              {date(query.data.creator.createdAt)} ·{' '}
              {query.data.creator.channel === 'UNKNOWN'
                ? 'Origen no registrado'
                : query.data.creator.channel}
            </small>
          </p>
          <p className="muted">
            Solo las acciones confirmadas cuentan como participación. El tiempo corresponde a
            intervalos explícitos de agentes; 0 registrado no estima el esfuerzo.
          </p>
          <People rows={query.data.participants} />
          {entityType === 'REQUIREMENT' && (
            <>
              <h3>Colaboradores en tareas principales</h3>
              <People rows={query.data.taskCollaborators} />
              <p className="muted">
                El tiempo conserva el requisito y sprint donde se inició cada tramo.
              </p>
            </>
          )}
          <p>
            Total registrado: <strong>{formatWorkDuration(query.data.totalMilliseconds)}</strong>
          </p>
          {query.data.owners.length > 0 && (
            <>
              <h4>Total por usuario propietario</h4>
              <ul className="criteria">
                {query.data.owners.map((owner) => {
                  const identity = [
                    ...query.data!.participants,
                    ...query.data!.taskCollaborators,
                  ].find((p) => p.identity?.ownerUserId === owner.ownerUserId)?.identity;
                  return (
                    <li key={owner.ownerUserId}>
                      <span>
                        {identity?.ownerUsername ?? `Usuario ${owner.ownerUserId.slice(0, 8)}`}
                      </span>
                      <b>{formatWorkDuration(owner.milliseconds)}</b>
                    </li>
                  );
                })}
              </ul>
              <small className="muted">
                Suma el tiempo de sus agentes; los agentes paralelos suman sus intervalos.
              </small>
            </>
          )}
        </>
      )}
    </section>
  );
}
function People({ rows }: { rows: Person[] }) {
  return rows.length === 0 ? (
    <p className="empty">Sin intervenciones registradas.</p>
  ) : (
    <div
      className="table-scroll"
      role="region"
      aria-label="Participantes y tiempo registrado"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th>Participante / usuario</th>
            <th>Acciones</th>
            <th>Última intervención</th>
            <th>Tiempo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.principalId}>
              <td>
                <strong>{label(p.identity, p.principalId)}</strong>
                <small>
                  {p.identity?.kind === 'AGENT'
                    ? `Usuario: ${p.identity.ownerUsername ?? p.identity.ownerUserId ?? 'no registrado'}`
                    : p.identity?.kind === 'HUMAN'
                      ? 'Usuario humano'
                      : 'Tipo de identidad no registrado'}{' '}
                  ·{' '}
                  {p.channels
                    .map((channel) => (channel === 'UNKNOWN' ? 'Origen no registrado' : channel))
                    .join(', ') || 'Origen no registrado'}
                </small>
              </td>
              <td>{p.actionCount}</td>
              <td>{p.lastAt ? date(p.lastAt) : 'Sin acción directa registrada'}</td>
              <td>
                {p.milliseconds === '0' ? '0 registrado' : formatWorkDuration(p.milliseconds)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
