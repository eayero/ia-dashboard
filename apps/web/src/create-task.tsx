import { useState, type FormEvent } from 'react';
import { createTaskSchema } from '@acc/contracts';
import { Modal, Notice, useCommand } from './components.tsx';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

export function CreateTask({
  projectId,
  csrf,
  blocked,
  close,
  created,
}: {
  projectId: string;
  csrf: string;
  blocked: boolean;
  close: () => void;
  created: (id: string) => void;
}) {
  const command = useCommand(projectId, csrf);
  const requirements = useQuery({
    queryKey: ['project', projectId, 'task-create-requirements'],
    queryFn: async ({ signal }) => {
      const items: { id: string; publicId: string; title: string }[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: typeof items; nextCursor: string | null } = await api(
          `/projects/${projectId}/requirements?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
          { signal },
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return items;
    },
  });
  const [invalid, setInvalid] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInvalid('');
    if (blocked || command.isPending) return;
    const form = new FormData(event.currentTarget);
    const criteria = String(form.get('criteria'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((description, i) => ({ id: `AC-${i + 1}`, description, required: true }));
    const externalRef = String(form.get('externalRef')).trim();
    const parsed = createTaskSchema.safeParse({
      title: form.get('title'),
      requirementIds: form.getAll('requirementIds'),
      workType: form.get('workType'),
      criteria,
      ...(externalRef ? { externalRef } : {}),
    });
    if (!parsed.success) {
      setInvalid('Indica un título, al menos un requisito y entre 1 y 100 criterios válidos.');
      return;
    }
    try {
      const task = await command.mutateAsync({
        path: `/projects/${projectId}/tasks`,
        body: parsed.data,
      });
      created(task.id as string);
    } catch {
      /* Error is rendered from mutation state. */
    }
  }
  return (
    <Modal title="Crear tarea" close={close}>
      <p className="muted">
        Define qué resultado debe aceptarse. La tarea empezará por planificar.
      </p>
      <form onSubmit={submit}>
        <fieldset
          disabled={
            blocked ||
            command.isPending ||
            requirements.isPending ||
            requirements.isError ||
            !requirements.data?.length
          }
        >
          <label>
            Título
            <input name="title" required maxLength={300} autoFocus />
          </label>
          <label>
            Requisitos asociados
            <select name="requirementIds" multiple required size={4}>
              {requirements.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.publicId} · {r.title}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Selecciona el alcance de esta tarea. Una propuesta pendiente conserva pendiente su
            aprobación.
          </p>
          <label>
            Tipo de trabajo
            <select name="workType">
              <option value="OTHER">General</option>
              <option value="CODE">Código</option>
            </select>
          </label>
          <label>
            Criterios de aceptación
            <textarea
              name="criteria"
              required
              rows={4}
              placeholder="Un criterio obligatorio por línea"
            />
          </label>
          <label>
            Referencia externa <span className="muted">(opcional)</span>
            <input name="externalRef" maxLength={300} />
          </label>
          <p className="muted">Una referencia externa exacta recupera la tarea existente.</p>
          <button className="primary" type="submit">
            {command.isPending ? 'Guardando…' : 'Guardar tarea'}
          </button>
        </fieldset>
        {requirements.isPending && <p role="status">Cargando requisitos…</p>}
        {requirements.error && (
          <Notice error={requirements.error} retry={() => void requirements.refetch()} />
        )}
        {requirements.data?.length === 0 && (
          <p role="alert">Primero registra un requisito en el catálogo del proyecto.</p>
        )}
        {invalid && (
          <p role="alert" className="field-error">
            {invalid}
          </p>
        )}
        {command.error && <Notice error={command.error} />}
      </form>
    </Modal>
  );
}
