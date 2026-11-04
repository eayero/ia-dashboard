import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  Outlet,
} from '@tanstack/react-router';
import {
  LayoutDashboard,
  ListTodo,
  BellRing,
  Users,
  Plus,
  RefreshCw,
  ArrowUpRight,
} from 'lucide-react';
import { api, ApiError, message } from './api.ts';
import { clearAuthenticatedState } from './auth-cache.ts';
import {
  dashboard,
  entities,
  type DashboardState,
  type Project,
  type Task,
  type Member,
  type Session,
  type Claim,
} from './data.ts';
import { Notice, Status, date, useCommand, Modal } from './components.tsx';
import { CreateTask } from './create-task.tsx';
import { TaskPanel } from './task-detail.tsx';
import { LoginForm, PasswordForm, type Me } from './auth-forms.tsx';
import { Accounts } from './accounts.tsx';

type Search = { projectId?: string; taskId?: string; view?: 'accounts' };
function App() {
  const client = useQueryClient();
  const search = rootRoute.useSearch();
  const navigate = useNavigate({ from: '/' });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async ({ signal }) => {
      try {
        return await api<Me>('/auth/me', { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    refetchInterval: (query) => (query.state.data ? 60000 : false),
  });
  const projects = useQuery({
    queryKey: ['projects', me.data?.principal.id],
    queryFn: ({ signal }) => api<Project[]>('/projects', { signal }),
    enabled: Boolean(me.data && !me.data.user.mustChangePassword),
  });
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  useEffect(() => {
    const expired = () => {
      void clearAuthenticatedState(client);
    };
    window.addEventListener('acc:auth-expired', expired);
    return () => window.removeEventListener('acc:auth-expired', expired);
  }, [client]);
  async function logout() {
    if (!me.data || loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await api('/auth/logout', { body: {}, csrf: me.data.csrfToken });
      await clearAuthenticatedState(client);
    } catch (error) {
      setLogoutError(error);
    } finally {
      setLoggingOut(false);
    }
  }
  if (me.isPending)
    return (
      <main className="welcome">
        <Brand />
        <p role="status">Comprobando tu sesión…</p>
      </main>
    );
  if (me.error)
    return (
      <main className="welcome">
        <Brand />
        <h1>No se pudo conectar</h1>
        <Notice error={me.error} retry={() => void me.refetch()} />
      </main>
    );
  if (!me.data)
    return (
      <main className="welcome">
        <Brand />
        <span className="eyebrow">CONTROL DE PROYECTOS CON AGENTES</span>
        <h1>
          El trabajo, con contexto.
          <br />
          Las decisiones, en tus manos.
        </h1>
        <p>
          Supervisa la ejecución, revisa evidencias y aprueba cada entrega desde un mismo lugar.
        </p>
        <LoginForm />
      </main>
    );
  if (me.data.user.mustChangePassword)
    return (
      <main className="welcome">
        <Brand />
        <h1>Cambia tu contraseña temporal</h1>
        <PasswordForm saved={() => undefined} />
        <button onClick={() => void logout()} disabled={loggingOut}>
          Salir
        </button>
      </main>
    );
  const project =
    projects.data?.find((item) => item.id === search.projectId) ??
    (!search.projectId ? projects.data?.[0] : undefined);
  return (
    <div className="app-shell">
      <a href="#main" className="skip">
        Ir al contenido
      </a>
      <header className="topbar">
        <Brand />
        <div className="project-picker">
          <label htmlFor="project">Proyecto</label>
          <select
            id="project"
            value={project?.id ?? ''}
            onChange={(event) => void navigate({ search: { projectId: event.target.value } })}
          >
            <option value="" disabled>
              Seleccionar proyecto
            </option>
            {projects.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        {me.data.user.systemRole === 'ADMIN' && (
          <button
            onClick={() =>
              void navigate({
                search:
                  search.view === 'accounts' ? { projectId: project?.id } : { view: 'accounts' },
              })
            }
          >
            {search.view === 'accounts' ? 'Volver al proyecto' : 'Usuarios y accesos'}
          </button>
        )}
        <button onClick={() => setChangingPassword(true)}>Mi contraseña</button>
        <button onClick={() => void logout()} disabled={loggingOut}>
          {loggingOut ? 'Saliendo…' : 'Salir'}
        </button>
      </header>
      {Boolean(logoutError) && <Notice error={logoutError} />}
      {search.view === 'accounts' && me.data.user.systemRole === 'ADMIN' ? (
        <Accounts me={me.data} />
      ) : projects.isPending ? (
        <main id="main" className="page">
          <p role="status">Cargando proyectos…</p>
        </main>
      ) : projects.error ? (
        <main id="main" className="page">
          <Notice error={projects.error} retry={() => void projects.refetch()} />
        </main>
      ) : !project ? (
        <main id="main" className="page">
          <h1>{search.projectId ? 'Proyecto no disponible' : 'Sin proyectos asignados'}</h1>
          <p>
            Selecciona un proyecto al que tengas acceso o solicita una asignación al administrador.
          </p>
        </main>
      ) : (
        <Dashboard
          key={project.id}
          project={project}
          me={me.data}
          taskId={search.taskId}
          openTask={(id) =>
            void navigate({ search: { projectId: project.id, ...(id ? { taskId: id } : {}) } })
          }
        />
      )}
      {changingPassword && (
        <Modal title="Cambiar tu contraseña" close={() => setChangingPassword(false)}>
          <PasswordForm saved={() => setChangingPassword(false)} />
        </Modal>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        a<span>c</span>c
      </span>
      <span>
        Agent
        <br />
        Control Center
      </span>
    </div>
  );
}

function Dashboard({
  project,
  me,
  taskId,
  openTask,
}: {
  project: Project;
  me: Me;
  taskId?: string;
  openTask: (id?: string) => void;
}) {
  const client = useQueryClient();
  const key = ['project', project.id, 'context', me.principal.id];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      dashboard(project.id, client.getQueryData<DashboardState>(key), signal),
    refetchInterval: 5000,
  });
  const command = useCommand(project.id, me.csrfToken);
  const [view, setView] = useState('overview');
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 5000);
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      clearInterval(clock);
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);
  const state = query.data;
  const forbidden = query.error instanceof ApiError && query.error.status === 403;
  const data = state && !forbidden ? state : undefined;
  const tasks = data ? entities<Task>(data, 'TASK') : [];
  const members = data ? entities<Member>(data, 'MEMBER') : [];
  const sessions = data ? entities<Session>(data, 'SESSION') : [];
  const claims = data
    ? entities<Claim>(data, 'CLAIM').filter(
        (c) => c.active && new Date(c.expiresAt).getTime() > now,
      )
    : [];
  const currentProject = data ? (entities<Project>(data, 'PROJECT')[0] ?? project) : project;
  const roles =
    members.find((m) => m.principalId === me.principal.id && m.active && !m.disabled)?.roles ?? [];
  const writable = roles.some((role) => ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER'].includes(role));
  const blocked =
    !data || !online || query.isError || now - data.checkedAt > 30000 || currentProject.archived;
  const attention = tasks.filter((task) => ['BLOCKED', 'IN_REVIEW', 'IN_QA'].includes(task.status));
  const selected = tasks.find((task) => task.id === taskId);
  const shown = (view === 'attention' ? attention : tasks).filter(
    (task) =>
      (filter === 'ALL' || task.status === filter) &&
      `${task.title} ${task.publicId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const nav = [
    { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
    { id: 'tasks', label: 'Tareas', icon: ListTodo },
    { id: 'attention', label: 'Atención pendiente', icon: BellRing },
    { id: 'sessions', label: 'Sesiones', icon: Users },
  ];
  async function sessionAction(session?: Session) {
    if (blocked || !writable || command.isPending) return;
    try {
      await command.mutateAsync({
        path: `/projects/${project.id}/agent-sessions${session ? `/${session.id}/end` : ''}`,
        body: session
          ? { expectedVersion: session.version, reason: 'Sesión finalizada desde el dashboard' }
          : {},
      });
    } catch {
      /* Rendered in session section. */
    }
  }
  return (
    <>
      <aside className="sidebar">
        <span className="eyebrow">ESPACIO DE TRABAJO</span>
        <nav aria-label="Principal">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setView(item.id);
                setFilter('ALL');
              }}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <item.icon size={18} aria-hidden="true" />
              {item.label}
              {item.id === 'attention' && data && (
                <span className="nav-count">{attention.length}</span>
              )}
            </button>
          ))}
        </nav>
        <p>
          Una fuente de verdad.
          <br />
          Cada cambio, con trazabilidad.
        </p>
      </aside>
      <main id="main" className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">PROYECTO / {project.name}</span>
            <h1>
              {view === 'overview'
                ? 'Resumen de ejecución'
                : nav.find((item) => item.id === view)?.label}
            </h1>
            <p className="muted">
              {currentProject.archived
                ? 'Proyecto archivado'
                : 'Estado compartido entre personas y agentes'}
            </p>
          </div>
          <div className="header-actions">
            <span className={`sync ${blocked ? 'pending' : ''}`} role="status">
              {!online
                ? 'Sin conexión'
                : query.isFetching
                  ? 'Actualizando…'
                  : query.isError
                    ? 'Datos desactualizados'
                    : data
                      ? 'Datos confirmados'
                      : 'Cargando…'}
            </span>
            <button
              className="icon-button"
              aria-label="Actualizar proyecto"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={18} aria-hidden="true" />
            </button>
            {writable && (
              <button className="primary" disabled={blocked} onClick={() => setCreating(true)}>
                <Plus size={17} aria-hidden="true" />
                Crear tarea
              </button>
            )}
          </div>
        </header>
        {query.error && <Notice error={query.error} retry={() => void query.refetch()} />}
        {!online && (
          <div className="notice" role="status">
            Estás sin conexión. Las acciones están pausadas hasta confirmar el estado actual.
          </div>
        )}
        {query.isPending && (
          <div className="loading-panel" role="status">
            <div className="skeleton" />
            <div className="skeleton" />
            <p>Cargando contexto completo del proyecto…</p>
          </div>
        )}
        {data && (
          <>
            {view === 'overview' && (
              <div className="stats">
                <div>
                  <span>Alcance definido</span>
                  <strong>
                    {tasks.length}
                    <small> tareas</small>
                  </strong>
                </div>
                <div>
                  <span>Completadas</span>
                  <strong>
                    {tasks.filter((t) => t.status === 'DONE').length}
                    <small> / {tasks.length}</small>
                  </strong>
                </div>
                <div>
                  <span>En ejecución</span>
                  <strong>{tasks.filter((t) => t.status === 'IN_PROGRESS').length}</strong>
                </div>
                <div className="attention-stat">
                  <span>Requieren atención</span>
                  <strong>{attention.length}</strong>
                </div>
              </div>
            )}
            {view === 'sessions' ? (
              <section className="panel">
                <div className="section-header">
                  <h2>Sesiones de trabajo</h2>
                  {writable && (
                    <button
                      className="primary"
                      disabled={blocked || command.isPending}
                      onClick={() => void sessionAction()}
                    >
                      Iniciar sesión de trabajo
                    </button>
                  )}
                </div>
                <p className="muted">
                  Una sesión identifica quién trabaja; cada tarea necesita su propio claim.
                </p>
                {command.error && <Notice error={command.error} />}
                {sessions.length === 0 ? (
                  <p className="empty">Todavía no hay sesiones de trabajo.</p>
                ) : (
                  <ul className="session-list">
                    {sessions.map((session) => (
                      <li key={session.id}>
                        <div>
                          <b>
                            {session.principalId === me.principal.id
                              ? 'Tu sesión'
                              : 'Sesión de trabajo'}
                          </b>
                          <code>{session.id.slice(0, 8)}</code>
                          <small>
                            {session.endedAt
                              ? 'Finalizada'
                              : new Date(session.expiresAt).getTime() <= now
                                ? 'Expirada'
                                : `Vigente hasta ${date(session.expiresAt)}`}
                          </small>
                        </div>
                        {session.principalId === me.principal.id && !session.endedAt && (
                          <button
                            disabled={blocked || command.isPending}
                            onClick={() => void sessionAction(session)}
                          >
                            Finalizar sesión
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              <div className={view === 'overview' ? 'columns' : ''}>
                <section className="panel task-panel">
                  <div className="section-header">
                    <h2>
                      {view === 'attention'
                        ? 'Tareas que requieren atención'
                        : 'Trabajo del proyecto'}
                    </h2>
                    <span className="muted">
                      {shown.length} de {tasks.length}
                    </span>
                  </div>
                  <div className="filters">
                    <label>
                      Buscar tarea
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Título o identificador"
                      />
                    </label>
                    <label>
                      Estado
                      <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                        <option value="ALL">Todos los estados</option>
                        {[
                          'BACKLOG',
                          'READY',
                          'IN_PROGRESS',
                          'BLOCKED',
                          'IN_REVIEW',
                          'IN_QA',
                          'DONE',
                          'CANCELLED',
                        ].map((status) => (
                          <option key={status} value={status}>
                            {
                              {
                                BACKLOG: 'Por planificar',
                                READY: 'Lista',
                                IN_PROGRESS: 'En ejecución',
                                BLOCKED: 'Bloqueada',
                                IN_REVIEW: 'En revisión',
                                IN_QA: 'En QA',
                                DONE: 'Completada',
                                CANCELLED: 'Cancelada',
                              }[status]
                            }
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {shown.length === 0 ? (
                    <div className="empty">
                      <h3>
                        {tasks.length === 0
                          ? 'El próximo trabajo empieza aquí'
                          : 'Sin tareas para esta selección'}
                      </h3>
                      <p>
                        {tasks.length === 0
                          ? 'Crea una tarea con criterios claros para empezar a coordinar la ejecución.'
                          : 'Prueba otro filtro o consulta el resumen del proyecto.'}
                      </p>
                      {tasks.length === 0 && writable && (
                        <button
                          className="primary"
                          disabled={blocked}
                          onClick={() => setCreating(true)}
                        >
                          Crear primera tarea
                        </button>
                      )}
                    </div>
                  ) : (
                    <div
                      className="table-scroll"
                      role="region"
                      aria-label="Tabla de tareas, desplazable horizontalmente"
                      tabIndex={0}
                    >
                      <table>
                        <caption className="sr-only">
                          Tareas, estado, propietario y vencimiento del claim
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Tarea</th>
                            <th scope="col">Estado</th>
                            <th scope="col">Propietario</th>
                            <th scope="col">Vencimiento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((task) => {
                            const owner = claims.find((c) => c.taskId === task.id);
                            return (
                              <tr key={task.id}>
                                <td>
                                  <small>{task.publicId}</small>
                                  <button className="task-link" onClick={() => openTask(task.id)}>
                                    {task.title}
                                  </button>
                                </td>
                                <td>
                                  <Status status={task.status} />
                                </td>
                                <td>
                                  {owner ? (
                                    owner.principalId === me.principal.id ? (
                                      'Tu sesión'
                                    ) : (
                                      `Otra sesión · ${owner.principalId.slice(0, 6)}`
                                    )
                                  ) : (
                                    <span className="muted">Sin claim</span>
                                  )}
                                </td>
                                <td>
                                  {owner ? (
                                    <time dateTime={owner.expiresAt}>{date(owner.expiresAt)}</time>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
                {view === 'overview' && (
                  <section className="panel inbox">
                    <span className="eyebrow">BANDEJA DE ATENCIÓN</span>
                    <h2>Necesita tu mirada</h2>
                    {attention.length === 0 ? (
                      <div className="inbox-empty">
                        <BellRing size={26} aria-hidden="true" />
                        <p>No hay tareas bloqueadas ni entregas en revisión o QA.</p>
                      </div>
                    ) : (
                      attention.map((task) => (
                        <article key={task.id}>
                          <Status status={task.status} />
                          <button className="task-link" onClick={() => openTask(task.id)}>
                            {task.title}
                            <ArrowUpRight size={15} aria-hidden="true" />
                          </button>
                          <small>
                            {task.publicId} · Revisión {task.workRevision}
                          </small>
                        </article>
                      ))
                    )}
                    <p className="muted inbox-note">
                      Las evidencias y aprobaciones se revisan en el detalle de cada tarea.
                    </p>
                  </section>
                )}
              </div>
            )}
            <footer className="page-footer">
              <span>Secuencia del proyecto {data.projectSeq}</span>
              <span>Última comprobación {new Date(data.checkedAt).toLocaleTimeString('es')}</span>
              <span>{writable ? 'Acceso de gestión' : 'Acceso de consulta'}</span>
            </footer>
          </>
        )}
      </main>
      {creating && (
        <CreateTask
          projectId={project.id}
          csrf={me.csrfToken}
          blocked={blocked || !writable}
          close={() => setCreating(false)}
          created={(id) => {
            setCreating(false);
            openTask(id);
          }}
        />
      )}
      {taskId && data && (
        <TaskPanel
          key={taskId}
          projectId={project.id}
          taskId={taskId}
          principalId={me.principal.id}
          csrf={me.csrfToken}
          roles={roles}
          sessions={sessions}
          currentVersion={selected?.version}
          blocked={blocked}
          close={() => openTask()}
        />
      )}
    </>
  );
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const rootRoute = createRootRoute({
  component: Outlet,
  validateSearch: (value: Record<string, unknown>): Search => ({
    ...(value.view === 'accounts' ? { view: 'accounts' as const } : {}),
    ...(typeof value.projectId === 'string' && uuid.test(value.projectId)
      ? { projectId: value.projectId }
      : {}),
    ...(typeof value.taskId === 'string' && uuid.test(value.taskId)
      ? { taskId: value.taskId }
      : {}),
  }),
  errorComponent: ({ error }) => (
    <main className="welcome">
      <h1>No se pudo mostrar la aplicación</h1>
      <p>{message(error)}</p>
      <button onClick={() => window.location.reload()}>Volver a cargar</button>
    </main>
  ),
});
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: App });
export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
