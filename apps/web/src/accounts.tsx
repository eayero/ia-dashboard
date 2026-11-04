import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';
import { Modal, Notice } from './components.tsx';
import type { Me } from './auth-forms.tsx';
import { Agents } from './agents.tsx';

type Assignment = { id: string; name: string; roles: string[]; active: boolean; version: number };
type User = {
  id: string;
  username: string;
  displayName: string;
  systemRole: string;
  mustChangePassword: boolean;
  disabled: boolean;
  projects: Assignment[];
  agents: { id: string; name: string }[];
};
export function Accounts({ me }: { me: Me }) {
  const client = useQueryClient();
  const users = useQuery({
    queryKey: ['accounts', me.principal.id],
    queryFn: ({ signal }) =>
      api<{ users: User[]; projects: { id: string; name: string }[] }>('/admin/users', { signal }),
  });
  const [selected, setSelected] = useState(''),
    [projectId, setProject] = useState('');
  const [reset, setReset] = useState<User | null>(null);
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
                      <th>Agentes del usuario</th>
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
                          {user.agents.length
                            ? user.agents.map((agent) => <div key={agent.id}>{agent.name}</div>)
                            : 'Sin agentes'}
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
            <Agents me={me} all />
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
    </main>
  );
}
