import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';
import { Modal, Notice, date } from './components.tsx';
import type { Me } from './auth-forms.tsx';

type ProjectAccess = {
  id: string;
  name: string;
  active: boolean;
  version: number;
  scopes: string[];
};
type Agent = {
  id: string;
  name: string;
  ownerUserId: string;
  ownerUsername: string;
  projects: ProjectAccess[];
  credentials: {
    id: string;
    label: string;
    scopes: string[];
    audiences: string[];
    expiresAt: string;
    revokedAt: string | null;
  }[];
};
type Owner = {
  id: string;
  username: string;
  disabled: boolean;
  projects: { id: string; name: string; active: boolean; roles: string[] }[];
};

export function Agents({ me, all = false }: { me: Me; all?: boolean }) {
  const client = useQueryClient();
  const identities = useQuery({
    queryKey: ['agents', all, me.principal.id],
    queryFn: ({ signal }) => api<Agent[]>(all ? '/admin/agent-identities' : '/agents', { signal }),
  });
  const owners = useQuery({
    queryKey: ['accounts', me.principal.id],
    queryFn: ({ signal }) => api<{ users: Owner[] }>('/admin/users', { signal }),
    enabled: all,
  });
  const projects = useQuery({
    queryKey: ['projects', me.principal.id],
    queryFn: ({ signal }) => api<{ id: string; name: string }[]>('/projects', { signal }),
  });
  const [ownerId, setOwner] = useState(me.principal.id);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [issued, setIssued] = useState<{ token: string } | null>(null);
  const command = useMutation({
    gcTime: 0,
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api<{ token?: string }>(path, { body, csrf: me.csrfToken }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['agents'] }),
        client.invalidateQueries({ queryKey: ['credentials'] }),
        client.invalidateQueries({ queryKey: ['accounts'] }),
        client.invalidateQueries({ queryKey: ['project'] }),
      ]);
    },
  });
  const available = (id: string) =>
    all
      ? (owners.data?.users
          .find((user) => user.id === id)
          ?.projects.filter((project) => project.active) ?? [])
      : (projects.data ?? []);
  async function act(path: string, body: unknown) {
    if (command.isPending) return;
    try {
      await command.mutateAsync({ path, body });
    } catch {
      /* Rendered below. */
    }
  }
  async function issue(event: FormEvent<HTMLFormElement>, agent?: Agent) {
    event.preventDefault();
    if (command.isPending) return;
    const form = event.currentTarget,
      data = new FormData(form);
    const input = {
      label: data.get('label'),
      scopes: data.get('write') === 'on' ? ['task:read', 'task:write'] : ['task:read'],
      audiences: data.getAll('audiences'),
      expiresInDays: Number(data.get('days')),
    };
    try {
      const result = await command.mutateAsync({
        path: agent ? `/agents/${agent.id}/credentials` : '/agents',
        body: agent
          ? input
          : { ...input, ownerUserId: ownerId, projectIds: data.getAll('projectIds') },
      });
      form.reset();
      setSelected(null);
      if (result.token) setIssued({ token: result.token });
    } catch {
      /* Rendered below. */
    }
  }
  const permissions = (
    <>
      <div className="checks">
        <label>
          <input name="audiences" type="checkbox" value="api" defaultChecked />
          API
        </label>
        <label>
          <input name="audiences" type="checkbox" value="mcp" defaultChecked />
          MCP
        </label>
        <label>
          <input name="write" type="checkbox" />
          Permitir escritura
        </label>
      </div>
      <label>
        Vigencia en días
        <input name="days" type="number" min={1} max={30} defaultValue={1} required />
      </label>
    </>
  );
  return (
    <section className="panel admin-form">
      <h2>{all ? 'Agentes de usuarios' : 'Mis agentes'}</h2>
      <p className="muted">
        Cada agente pertenece a una persona y puede trabajar en varios proyectos. Sus credenciales
        API/MCP son revocables y el secreto se muestra una sola vez.
      </p>
      {identities.isPending && <p role="status">Cargando agentes…</p>}
      {identities.error && (
        <Notice error={identities.error} retry={() => void identities.refetch()} />
      )}
      {owners.error && <Notice error={owners.error} retry={() => void owners.refetch()} />}
      {command.error && <Notice error={command.error} />}
      {identities.data?.map((agent) => (
        <article className="evidence" key={agent.id}>
          <h3>{agent.name}</h3>
          <p>
            Agente de <b>{agent.ownerUsername}</b>
          </p>
          <ul>
            {agent.projects.map((project) => (
              <li key={project.id}>
                {project.name} · {project.scopes.join(', ')}
                {!project.active && ' · acceso retirado'}
                {project.active && (
                  <button
                    disabled={command.isPending}
                    onClick={() =>
                      void act(`/agents/${agent.id}/projects/${project.id}`, {
                        active: false,
                        scopes: project.scopes,
                        expectedVersion: project.version,
                      })
                    }
                  >
                    Retirar acceso a {project.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <details>
            <summary>Asignar proyecto a {agent.name}</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget),
                  projectId = String(data.get('projectId'));
                const previous = agent.projects.find((project) => project.id === projectId);
                void act(`/agents/${agent.id}/projects/${projectId}`, {
                  active: true,
                  scopes: data.get('write') === 'on' ? ['task:read', 'task:write'] : ['task:read'],
                  expectedVersion: previous?.version ?? 0,
                });
              }}
            >
              <fieldset disabled={command.isPending}>
                <label>
                  Proyecto para {agent.name}
                  <select name="projectId" required defaultValue="">
                    <option value="">Selecciona un proyecto</option>
                    {available(agent.ownerUserId).map((project) => (
                      <option value={project.id} key={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <input type="checkbox" name="write" />
                  Permitir escritura en el proyecto
                </label>
                <button type="submit">Guardar acceso de {agent.name}</button>
              </fieldset>
            </form>
          </details>
          <h4>Credenciales</h4>
          <ul>
            {agent.credentials.map((credential) => (
              <li key={credential.id}>
                {credential.label} · {credential.audiences.join(' / ')} ·{' '}
                {credential.scopes.join(', ')} ·{' '}
                {credential.revokedAt ? 'Revocada' : `Hasta ${date(credential.expiresAt)}`}
                {!credential.revokedAt && (
                  <button
                    disabled={command.isPending}
                    onClick={() => void act(`/agents/credentials/${credential.id}/revoke`, {})}
                  >
                    Revocar {credential.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button disabled={command.isPending} onClick={() => setSelected(agent)}>
            Emitir otra credencial para {agent.name}
          </button>
        </article>
      ))}
      <details>
        <summary>Crear agente</summary>
        <form key={ownerId} onSubmit={(event) => void issue(event)}>
          <fieldset disabled={command.isPending}>
            {all && (
              <label>
                Usuario propietario
                <select value={ownerId} onChange={(event) => setOwner(event.target.value)}>
                  {owners.data?.users
                    .filter((user) => !user.disabled)
                    .map((user) => (
                      <option value={user.id} key={user.id}>
                        {user.username}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Nombre del agente
              <input name="label" required maxLength={120} />
            </label>
            <fieldset>
              <legend>Proyectos del agente</legend>
              {available(ownerId).map((project) => (
                <label className="check-label" key={project.id}>
                  <input type="checkbox" name="projectIds" value={project.id} />
                  {project.name}
                </label>
              ))}
            </fieldset>
            {permissions}
            <p className="muted">
              El agente no puede superar los permisos de su propietario en el proyecto.
            </p>
            <button className="primary" type="submit">
              Crear agente y credencial
            </button>
          </fieldset>
        </form>
      </details>
      {selected && (
        <Modal title={`Credencial para ${selected.name}`} close={() => setSelected(null)}>
          <form onSubmit={(event) => void issue(event, selected)}>
            <fieldset disabled={command.isPending}>
              <label>
                Nombre de la credencial
                <input name="label" required maxLength={120} />
              </label>
              {permissions}
              <button className="primary" type="submit">
                Emitir credencial
              </button>
            </fieldset>
          </form>
          {command.error && <Notice error={command.error} />}
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
            Configura este agente en MCP enviando la credencial en Authorization: Bearer. La misma
            configuración puede acceder a todos sus proyectos autorizados.
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
    </section>
  );
}
