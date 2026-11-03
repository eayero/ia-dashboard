import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { clearAuthenticatedState } from './auth-cache.ts';

test('expirar sesión notifica al observador y elimina datos de proyectos de la identidad anterior', async () => {
  const client = new QueryClient();
  client.setQueryData(['me'], { principal: { id: 'previous' } });
  client.setQueryData(['project', 'private'], { fencingToken: 'private' });
  const observer = new QueryObserver(client, { queryKey: ['me'], enabled: false });
  const changes: unknown[] = [];
  const unsubscribe = observer.subscribe((result) => changes.push(result.data));
  try {
    await clearAuthenticatedState(client);
    assert.equal(observer.getCurrentResult().data, null);
    assert.equal(changes.at(-1), null);
    assert.equal(client.getQueryData(['project', 'private']), undefined);
  } finally {
    unsubscribe();
    client.clear();
  }
});
