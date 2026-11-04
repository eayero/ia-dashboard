import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';
import { Modal, Notice, date } from './components.tsx';
import type { Me } from './auth-forms.tsx';

type Assignment = { id: string; name: string; roles: string[]; active: boolean; version: number };
type User = {
  id: string;
  username: string;
  displayName: string;
  systemRole: string;
  mustChangePassword: boolean;
  disabled: boolean;
  projects: Assignment[];
};
type Credential = {
  id: string;
  principalId: string;
  label: string;
  scopes: string[];
  audiences: string[];
  expiresAt: string;
  revokedAt: string | null;
  token?: string;
  projects: { id: string; name: string }[];
};
export function Accounts({ me }: { me: Me }) {
  const client = useQueryClient();
  const users = useQuery({
    queryKey: ['accounts', me.principal.id],
    queryFn: ({ signal }) =>
      api<{ users: User[]; projects: { id: string; name: string }[] }>('/admin/users', { signal }),
  });
  const agents = useQuery({
    queryKey: ['credentials', me.principal.id],
    queryFn: ({ signal }) => api<Credential[]>('/admin/agents', { signal }),
  });
  const [selected, setSelected] = useState(''),
    [projectId, setProject] = useState('');
  const [reset, setReset] = useState<User | null>(null),
    [issued, setIssued] = useState<Credential | null>(null);
  const command = useMutation({
    gcTime: 0,
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api<Record<string, unknown>>(path, { body, csrf: me.csrfToken }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['accounts'] }),
        client.invalidateQueries({ queryKey: ['credentials'] }),
        client.invalidateQueries({ queryKey: ['projects'] }),
        client.invalidateQueries({ queryKey: ['project'] }),
      ]);
    },
  });
  const user = users.data?.users.find((user) => user.id === selected);
  const assignment = user?.projects.find((project) => project.id === projectId);
  async function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    body: (data: FormData) => unknown,
    done?: (data: Record<string, unknown>) => void,
  ) {
    event.preventDefault();
    if (command.isPending) return;
    const form = event.currentTarget;
    try {
      const data = await command.mutateAsync({ path, body: body(new FormData(form)) });
      form.reset();
      done?.(data);
    } catch {
      /* Rendered below. */
    }
  }
  async function act(path: string, body: unknown) {
    if (command.isPending) return;
    try {
      await command.mutateAsync({ path, body });
    } catch {
      /* Rendered below. */
    }
  }
  return (
    <main id="main" className="page accounts-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">ADMINISTRACIÓN DE ACC</span>
          <h1>Usuarios y accesos</h1>
          <p className="muted">
            Cuentas del sistema, proyectos asignados y credenciales de agentes.
          </p>
        </div>
      </header>
      {users.error && <Notice error={users.error} retry={() => void users.refetch()} />}
      {agents.error && <Notice error={agents.error} retry={() => void agents.refetch()} />}
      {command.error && <Notice error={command.error} />}
      {users.isPending ? (
        <p role="status">Cargando usuarios…</p>
      ) : (
        users.data && (
          <>
            <section className="panel">
              <div className="section-header">
                <h2>Usuarios del sistema</h2>
                <span className="muted">{users.data.users.length} cuentas</span>
              </div>
              <div
                className="table-scroll"
                role="region"
                aria-label="Usuarios y proyectos, tabla desplazable"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Acceso</th>
                      <th>Proyectos asociados</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.data.users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <b>{user.displayName}</b>
                          <small>{user.username}</small>
                        </td>
                        <td>
                          {user.disabled
                            ? 'Deshabilitado'
                            : user.systemRole === 'ADMIN'
                              ? 'Administrador del sistema'
                              : 'Usuario'}
                          {user.mustChangePassword && <small>Contraseña temporal</small>}
                        </td>
                        <td>
                          {user.projects.length
                            ? user.projects.map((project) => (
                                <div key={project.id}>
                                  {project.name} · {project.roles.join(', ')}
                                  {!project.active && ' · retirado'}
                                </div>
                              ))
                            : 'Sin asignación'}
                        </td>
                        <td>
                          <div className="actions">
                            <button
                              disabled={command.isPending}
                              onClick={() => {
                                setSelected(user.id);
                                setProject('');
                              }}
                            >
                              Asignaciones
                            </button>
                            {user.id !== me.principal.id && (
                              <>
                                <button disabled={command.isPending} onClick={() => setReset(user)}>
                                  Restablecer contraseña
                                </button>
                                <button
                                  disabled={command.isPending}
                                  onClick={() =>
                                    void act(`/admin/users/${user.id}/status`, {
                                      disabled: !user.disabled,
                                    })
                                  }
                                >
                                  {user.disabled ? 'Habilitar' : 'Deshabilitar'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="admin-form">
                <summary>Crear usuario</summary>
                <form
                  onSubmit={(event) =>
                    void submit(
                      event,
                      '/admin/users',
                      (data) => ({
                        username: data.get('username'),
                        displayName: data.get('displayName'),
                        password: data.get('password'),
                        systemRole: data.get('systemRole'),
                      }),
                      (data) => setSelected(data.id as string),
                    )
                  }
                >
                  <fieldset disabled={command.isPending}>
                    <label>
                      Nombre de usuario
                      <input
                        name="username"
                        required
                        minLength={3}
                        maxLength={64}
                        pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Nombre visible
                      <input name="displayName" required maxLength={120} />
                    </label>
                    <label>
                      Contraseña temporal
                      <input
                        name="password"
                        type="password"
                        required
                        minLength={15}
                        maxLength={128}
                        autoComplete="new-password"
                      />
                    </label>
                    <label>
                      Acceso al sistema
                      <select name="systemRole">
                        <option value="USER">Usuario</option>
                        <option value="ADMIN">Administrador del sistema</option>
                      </select>
                    </label>
                    <p className="muted">
                      Deberá cambiar la contraseña al entrar. Un administrador puede gestionar todas
                      las cuentas y sus asignaciones.
                    </p>
                    <button className="primary" type="submit">
                      Crear cuenta
                    </button>
                  </fieldset>
                </form>
              </details>
            </section>
            {user && (
              <section className="panel admin-form">
                <h2>Proyectos de {user.username}</h2>
                <label>
                  Proyecto a asignar
                  <select value={projectId} onChange={(event) => setProject(event.target.value)}>
                    <option value="">Selecciona un proyecto</option>
                    {users.data.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                {projectId && (
                  <form
                    key={`${user.id}-${projectId}-${assignment?.version ?? 0}`}
                    onSubmit={(event) =>
                      void submit(
                        event,
                        `/admin/users/${user.id}/projects/${projectId}`,
                        (data) => ({
                          active: data.get('active') === 'on',
                          roles: data.getAll('roles'),
                          expectedVersion: assignment?.version ?? 0,
                        }),
                      )
                    }
                  >
                    <fieldset disabled={command.isPending}>
                      <div className="checks">
                        {['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'VIEWER'].map((role) => (
                          <label key={role}>
                            <input
                              name="roles"
                              value={role}
                              type="checkbox"
                              defaultChecked={
                                assignment ? assignment.roles.includes(role) : role === 'VIEWER'
                              }
                            />
                            {role}
                          </label>
                        ))}
                      </div>
                      <label className="check-label">
                        <input
                          name="active"
                          type="checkbox"
                          defaultChecked={assignment?.active ?? true}
                        />
                        Acceso activo al proyecto
                      </label>
                      <p className="muted">
                        Modificar roles invalida claims existentes; retirar acceso finaliza sus
                        sesiones de trabajo en el proyecto.
                      </p>
                      <button className="primary" type="submit">
                        Guardar asignación
                      </button>
                    </fieldset>
                  </form>
                )}
              </section>
            )}
            <section className="panel admin-form">
              <h2>Credenciales de agentes</h2>
              <p className="muted">
                Cada credencial tiene proyecto, permisos, canales y caducidad. Su secreto se muestra
                una sola vez.
              </p>
              <div
                className="table-scroll"
                role="region"
                aria-label="Credenciales de agentes, tabla desplazable"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Agente</th>
                      <th>Proyecto y permisos</th>
                      <th>Vigencia</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.data?.map((agent) => (
                      <tr key={agent.id}>
                        <td>
                          {agent.label}
                          <small>{agent.audiences.join(' / ')}</small>
                        </td>
                        <td>
                          {agent.projects.map((project) => project.name).join(', ')}
                          <small>{agent.scopes.join(', ')}</small>
                        </td>
                        <td>{agent.revokedAt ? 'Revocada' : `Hasta ${date(agent.expiresAt)}`}</td>
                        <td>
                          {!agent.revokedAt && (
                            <button
                              disabled={command.isPending}
                              onClick={() => void act(`/admin/agents/${agent.id}/revoke`, {})}
                            >
                              Revocar credencial
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="admin-form">
                <summary>Crear credencial de agente</summary>
                <form
                  onSubmit={(event) =>
                    void submit(
                      event,
                      '/admin/agents',
                      (data) => ({
                        label: data.get('label'),
                        projectId: data.get('projectId'),
                        scopes:
                          data.get('write') === 'on' ? ['task:read', 'task:write'] : ['task:read'],
                        audiences: data.getAll('audiences'),
                        expiresInDays: Number(data.get('days')),
                      }),
                      (data) => setIssued(data as unknown as Credential),
                    )
                  }
                >
                  <fieldset disabled={command.isPending}>
                    <label>
                      Nombre del agente
                      <input name="label" required maxLength={120} />
                    </label>
                    <label>
                      Proyecto del agente
                      <select name="projectId" required>
                        <option value="">Selecciona un proyecto</option>
                        {users.data.projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="checks">
                      <label>
                        <input type="checkbox" name="audiences" value="api" defaultChecked />
                        API
                      </label>
                      <label>
                        <input type="checkbox" name="audiences" value="mcp" defaultChecked />
                        MCP
                      </label>
                      <label>
                        <input type="checkbox" name="write" />
                        Permitir escritura
                      </label>
                    </div>
                    <label>
                      Vigencia en días
                      <input name="days" type="number" min={1} max={30} defaultValue={1} required />
                    </label>
                    <button className="primary" type="submit">
                      Emitir credencial
                    </button>
                  </fieldset>
                </form>
              </details>
            </section>
          </>
        )
      )}
      {reset && (
        <Modal title={`Restablecer contraseña de ${reset.username}`} close={() => setReset(null)}>
          <form
            onSubmit={(event) =>
              void submit(
                event,
                `/admin/users/${reset.id}/password`,
                (data) => ({ password: data.get('password') }),
                () => setReset(null),
              )
            }
          >
            <fieldset disabled={command.isPending}>
              <label>
                Nueva contraseña temporal
                <input
                  name="password"
                  type="password"
                  required
                  minLength={15}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <p>Se cerrarán sus accesos actuales y deberá cambiar esta contraseña al entrar.</p>
              <button className="primary" type="submit">
                Restablecer acceso
              </button>
            </fieldset>
            {command.error && <Notice error={command.error} />}
          </form>
        </Modal>
      )}
      {issued && (
        <Modal
          title="Credencial emitida"
          close={() => {
            setIssued(null);
            command.reset();
          }}
        >
          <p>Guarda este secreto ahora. No podrá consultarse de nuevo.</p>
          <label>
            Credencial del agente
            <textarea readOnly rows={4} value={issued.token} />
          </label>
          <p className="muted">
            Envíala en Authorization: Bearer. Caduca {date(issued.expiresAt)}.
          </p>
          <button
            className="primary"
            onClick={() => {
              setIssued(null);
              command.reset();
            }}
          >
            Ya la guardé
          </button>
        </Modal>
      )}
    </main>
  );
}
