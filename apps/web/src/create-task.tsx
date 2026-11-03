import { useState, type FormEvent } from 'react';
import { createTaskSchema } from '@acc/contracts';
import { Modal, Notice, useCommand } from './components.tsx';

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
      workType: form.get('workType'),
      criteria,
      ...(externalRef ? { externalRef } : {}),
    });
    if (!parsed.success) {
      setInvalid('Indica un título y entre 1 y 100 criterios válidos, uno por línea.');
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
        <fieldset disabled={blocked || command.isPending}>
          <label>
            Título
            <input name="title" required maxLength={300} autoFocus />
          </label>
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
