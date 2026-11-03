import { randomUUID } from 'node:crypto';

// Test-owned Keycloak clients only; never changes shared agent credentials/scopes.
export async function mcpTokenFixture(issuer: string, audience: string, scope: string) {
  const url = new URL(issuer);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local issuer required');
  const realm = /^\/realms\/([a-zA-Z0-9_-]+)$/u.exec(url.pathname)?.[1];
  if (!realm) throw new Error('Local realm required');
  const response = await fetch(`${url.origin}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: process.env.KEYCLOAK_ADMIN!,
      password: process.env.KEYCLOAK_ADMIN_PASSWORD!,
    }),
  });
  if (!response.ok) throw new Error('Test administrator authentication failed');
  const adminToken = (await response.json()).access_token as string;
  const root = `${url.origin}/admin/realms/${realm}/clients`;
  const clientId = `acc-test-${randomUUID()}`;
  const clientSecret = randomUUID();
  const headers = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
  const created = await fetch(root, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientId,
      secret: clientSecret,
      protocol: 'openid-connect',
      publicClient: false,
      serviceAccountsEnabled: true,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      defaultClientScopes: scope.split(' '),
      optionalClientScopes: [],
      protocolMappers: [
        {
          name: 'audience',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-audience-mapper',
          config: {
            'included.custom.audience': audience,
            'access.token.claim': 'true',
            'id.token.claim': 'false',
          },
        },
      ],
    }),
  });
  if (created.status !== 201) throw new Error('Test client creation failed');
  const location = created.headers.get('location');
  const id = location?.split('/').at(-1);
  if (!id || !/^[a-f0-9-]{36}$/u.test(id)) throw new Error('Test client identity missing');
  const cleanup = async () => {
    const removed = await fetch(`${root}/${id}`, { method: 'DELETE', headers });
    if (removed.status !== 204) throw new Error('Test client cleanup failed');
  };
  try {
    const service = await fetch(`${root}/${id}/service-account-user`, { headers });
    if (!service.ok) throw new Error('Test service account missing');
    const subject = (await service.json()).id as string;
    const tokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        resource: audience,
      }),
    });
    if (!tokenResponse.ok) throw new Error('Test token issuance failed');
    return { token: (await tokenResponse.json()).access_token as string, subject, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
