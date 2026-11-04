import { useState, type FormEvent } from 'react';
import { createRequirementSchema, reviseRequirementSchema } from '@acc/contracts';
import { Modal, Notice, useCommand } from './components.tsx';
import type { RequirementRevision } from './requirements-data.ts';

export function RequirementForm({
  projectId,
  csrf,
  blocked,
  revision,
  requirementId,
  version,
  saved,
  close,
}: {
  projectId: string;
  csrf: string;
  blocked: boolean;
  revision?: RequirementRevision;
  requirementId?: string;
  version?: number;
  saved: (id: string) => void;
  close: () => void;
}) {
  const command = useCommand(projectId, csrf),
    [invalid, setInvalid] = useState(false),
    [baseVersion] = useState(version);
  const stale = Boolean(revision && version !== baseVersion);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || stale || command.isPending) return;
    const form = new FormData(event.currentTarget),
      content = {
        title: form.get('title'),
        description: form.get('description'),
        type: form.get('type'),
      };
    const parsed = revision
      ? reviseRequirementSchema.safeParse({
          ...content,
          reason: form.get('reason'),
          expectedVersion: baseVersion,
        })
      : createRequirementSchema.safeParse(content);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    try {
      const result = await command.mutateAsync({
        path: `/projects/${projectId}/requirements${requirementId ? `/${requirementId}/revise` : ''}`,
        body: parsed.data,
      });
      saved(String(result.id));
    } catch {
      /* Error is displayed without clearing the form. */
    }
  }
  return (
    <Modal title={revision ? 'Proponer nueva revisión' : 'Proponer requisito'} close={close}>
      <p className="muted">
        La propuesta no sustituye la revisión aprobada hasta que una persona autorizada la apruebe.
      </p>
      {blocked && (
        <p className="notice" role="status">
          Actualiza el proyecto antes de enviar la propuesta.
        </p>
      )}
      {stale && (
        <p className="notice" role="alert">
          El requisito cambió. Tus campos se conservan; cierra este formulario y revisa la versión
          actual antes de proponer de nuevo.
        </p>
      )}
      {command.error && <Notice error={command.error} />}
      {invalid && (
        <p className="notice error" role="alert">
          Completa título, descripción, tipo y motivo cuando corresponda.
        </p>
      )}
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={blocked || stale || command.isPending}>
          <label>
            Título
            <input name="title" maxLength={300} defaultValue={revision?.title} required autoFocus />
          </label>
          <label>
            Tipo
            <select name="type" defaultValue={revision?.type ?? 'FUNCTIONAL'}>
              <option value="FUNCTIONAL">Funcional</option>
              <option value="NON_FUNCTIONAL">No funcional</option>
            </select>
          </label>
          <label>
            Descripción
            <textarea
              name="description"
              maxLength={4000}
              rows={5}
              defaultValue={revision?.description}
              required
            />
          </label>
          {revision && (
            <label>
              Motivo de la nueva revisión
              <textarea name="reason" maxLength={4000} rows={3} required />
            </label>
          )}
          <div className="actions">
            <button type="submit" className="primary">
              {command.isPending ? 'Guardando…' : 'Guardar propuesta'}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
