import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';
import { Notice } from './components.tsx';

export type Me = {
  principal: { id: string; kind: string };
  csrfToken: string;
  user: {
    username: string;
    displayName: string;
    systemRole: 'ADMIN' | 'USER';
    mustChangePassword: boolean;
  };
};
export function LoginForm() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const anonymous = await api<{ csrfToken: string }>('/auth/session');
      const me = await api<Me>('/auth/login', {
        csrf: anonymous.csrfToken,
        body: { username: data.get('username'), password: data.get('password') },
      });
      client.setQueryData(['me'], me);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="login-form">
      <fieldset disabled={busy}>
        <label>
          Usuario
          <input
            name="username"
            required
            autoComplete="username"
            autoCapitalize="none"
            maxLength={64}
            autoFocus
          />
        </label>
        <label>
          Contraseña
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            maxLength={128}
          />
        </label>
        <button className="primary" type="submit">
          {busy ? 'Entrando…' : 'Entrar a ACC'}
        </button>
      </fieldset>
      {Boolean(error) && <Notice error={error} />}
      <small>
        Si olvidaste tu contraseña, un administrador puede restablecerla y darte una temporal.
      </small>
    </form>
  );
}
export function PasswordForm({ saved }: { saved: () => void }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [invalid, setInvalid] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    if (data.get('newPassword') !== data.get('confirm')) {
      setInvalid('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (data.get('newPassword') === data.get('currentPassword')) {
      setInvalid('La nueva contraseña debe ser diferente de la actual.');
      return;
    }
    setInvalid('');
    setBusy(true);
    setError(null);
    try {
      const current = client.getQueryData<Me>(['me'])!;
      const me = await api<Me>('/auth/password', {
        csrf: current.csrfToken,
        body: {
          currentPassword: data.get('currentPassword'),
          newPassword: data.get('newPassword'),
        },
      });
      client.setQueryData(['me'], me);
      await client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
      saved();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label>
          Contraseña actual
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            maxLength={128}
            autoFocus
          />
        </label>
        <label>
          Nueva contraseña
          <input
            name="newPassword"
            type="password"
            required
            minLength={15}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirmar nueva contraseña
          <input
            name="confirm"
            type="password"
            required
            minLength={15}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        <p className="muted">
          Usa entre 15 y 128 caracteres. El cambio cierra tus otras sesiones de acceso.
        </p>
        <button className="primary" type="submit">
          {busy ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </fieldset>
      {invalid && <p role="alert">{invalid}</p>}
      {Boolean(error) && <Notice error={error} />}
    </form>
  );
}
