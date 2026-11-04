import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { Notice } from './components.tsx';
import { formatWorkDuration, type TaskWorkTime } from './work-time.ts';
export function TaskTime({
  projectId,
  taskId,
  principalId,
}: {
  projectId: string;
  taskId: string;
  principalId: string;
}) {
  const [timeZone, setTimeZone] = useState('America/Caracas');
  const query = useQuery({
    queryKey: ['project', projectId, 'task-time', taskId, principalId, timeZone],
    queryFn: ({ signal }) =>
      api<TaskWorkTime>(
        `/projects/${projectId}/tasks/${taskId}/time?timeZone=${encodeURIComponent(timeZone)}`,
        { signal },
      ),
    refetchInterval: 5000,
  });
  const data = query.data;
  const instant = (value: string) =>
    new Date(value).toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium', timeZone });
  return (
    <section className="task-time">
      <h3>Tiempo de trabajo de agentes</h3>
      <p className="muted">
        Acumula los intervalos iniciados explícitamente. Las pausas no suman tiempo.
      </p>
      <label>
        Zona del informe diario
        <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
          <option value="America/Caracas">America/Caracas</option>
          <option value="UTC">UTC</option>
        </select>
      </label>
      {query.isPending && <p role="status">Calculando tiempo registrado…</p>}
      {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
      {data && !query.isError && (
        <>
          <p className="time-total">
            <span>Total acumulado</span>
            <strong>{formatWorkDuration(data.totalMilliseconds)}</strong>
          </p>
          <small className="muted">
            Calculado hasta {instant(data.asOf)}
            {data.intervals.some((i) => i.state === 'RUNNING') ? ' · Hay trabajo en curso' : ''}
          </small>
          {data.intervals.length === 0 ? (
            <p className="empty">Esta tarea todavía no tiene intervalos de trabajo registrados.</p>
          ) : (
            <>
              <h3>Acumulado por agente</h3>
              <ul className="criteria">
                {data.agents.map((a) => (
                  <li key={a.principalId}>
                    <span>
                      {a.agentName} <code>{a.principalId.slice(0, 6)}</code>
                    </span>
                    <b>{formatWorkDuration(a.milliseconds)}</b>
                  </li>
                ))}
              </ul>
              <h3>Tiempo por día y agente</h3>
              <div
                className="table-scroll"
                role="region"
                aria-label="Tiempo por día y agente, desplazable horizontalmente"
                tabIndex={0}
              >
                <table>
                  <caption className="sr-only">Días de trabajo, agente y tiempo registrado</caption>
                  <thead>
                    <tr>
                      <th scope="col">Día</th>
                      <th scope="col">Agente</th>
                      <th scope="col">Tiempo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((day) => (
                      <tr key={`${day.date}:${day.principalId}`}>
                        <td>{day.date}</td>
                        <td>{day.agentName}</td>
                        <td>{formatWorkDuration(day.milliseconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Tramos registrados ({data.intervals.length})</summary>
                {data.intervals.map((i) => (
                  <article className="evidence" key={i.id}>
                    <b>
                      {i.agentName} · {formatWorkDuration(i.milliseconds)}
                    </b>
                    <p>
                      Inicio: {instant(i.startedAt)}
                      <br />
                      Fin {i.state === 'RUNNING' ? 'calculado' : 'registrado'}:{' '}
                      {instant(i.effectiveEnd)}
                    </p>
                    <small>
                      {i.state === 'RUNNING'
                        ? 'En curso'
                        : i.closeReason === 'PAUSED'
                          ? 'Pausado por el agente'
                          : i.closeReason === 'LEASE_EXPIRED'
                            ? 'Límite de sesión o claim alcanzado'
                            : 'Sesión o claim finalizado'}{' '}
                      · Revisión {i.workRevision}
                    </small>
                  </article>
                ))}
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
