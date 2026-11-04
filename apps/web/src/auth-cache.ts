import type { QueryClient } from '@tanstack/react-query';

export async function clearAuthenticatedState(client: QueryClient) {
  await client.cancelQueries();
  // Preserve the observed query so active subscribers see sign-out immediately.
  client.setQueryData(['me'], null);
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
  client.getMutationCache().clear();
}
