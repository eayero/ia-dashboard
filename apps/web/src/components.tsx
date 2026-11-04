import { useEffect, useRef, useId, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, message } from './api.ts';
import { statusText } from './data.ts';

export function Status({ status }: { status: string }) {
  return <span className={`pill state-${status}`}>{statusText[status] ?? status}</span>;
}
export function Notice({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <span>{message(error)}</span>
      {retry && <button onClick={retry}>Reintentar</button>}
    </div>
  );
}
export function Modal({
  title,
  close,
  children,
  className,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={className}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button onClick={close} aria-label="Cerrar detalle">
          Cerrar
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function useCommand(projectId: string, csrf: string) {
  const client = useQueryClient();
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  return useMutation({
    mutationFn: async ({ path, body }: { path: string; body: unknown }) => {
      const signature = JSON.stringify({ path, body });
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      return api<Record<string, unknown>>(path, { body, csrf, key: attempt.current.key });
    },
    onSuccess: async () => {
      attempt.current = null;
      await client.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: async () => {
      await client.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
}
export function date(value: string) {
  return new Date(value).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}
