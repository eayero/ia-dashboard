import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';

// Local bootstrap only. These credentials are never stored in the ACC database.
export async function provisionLocalAgents(
  issuer: string,
  realm: string,
  adminToken: string,
  pool: pg.Pool,
  projectId: string,
  mcpAudience: string,
) {
  const root = `${new URL(issuer).origin}/admin/realms/${realm}`;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${root}${path}`, {
      method,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Local agent provisioning failed (${response.status})`);
    return response;
  };
  const clientScopes: string[] = [];
  for (const name of ['task:read', 'task:write', 'acc:mcp']) {
    let scopes = z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          attributes: z.record(z.string(), z.string()).optional(),
        }),
      )
      .parse(await (await request('/client-scopes')).json());
    if (!scopes.some((scope) => scope.name === name)) {
      await request('/client-scopes', 'POST', {
        name,
        protocol: 'openid-connect',
        attributes: {
          'include.in.token.scope': 'true',
          'display.on.consent.screen': 'false',
          'acc.local-bootstrap': 'true',
        },
      });
      scopes = z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            attributes: z.record(z.string(), z.string()).optional(),
          }),
        )
        .parse(await (await request('/client-scopes')).json());
    }
    const scope = scopes.find((scope) => scope.name === name);
    if (!scope || scope.attributes?.['acc.local-bootstrap'] !== 'true')
      throw new Error('Unrecognized local client scope');
    clientScopes.push(scope.id);
  }
  const agents: { clientId: string; clientSecret: string; principalId: string }[] = [];
  for (const clientId of ['acc-local-agent-a', 'acc-local-agent-b']) {
    let clients = z
      .array(z.object({ id: z.uuid(), attributes: z.record(z.string(), z.string()).optional() }))
      .parse(await (await request(`/clients?clientId=${clientId}`)).json());
    if (clients.length === 0) {
      await request('/clients', 'POST', {
        clientId,
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        standardFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        attributes: { 'acc.local-bootstrap': 'true', 'access.token.lifespan': '300' },
        protocolMappers: [
          {
            name: 'acc-api-audience',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-audience-mapper',
            config: {
              'included.custom.audience': 'acc-api',
              'access.token.claim': 'true',
              'id.token.claim': 'false',
            },
          },
        ],
      });
      clients = z
        .array(z.object({ id: z.uuid(), attributes: z.record(z.string(), z.string()).optional() }))
        .parse(await (await request(`/clients?clientId=${clientId}`)).json());
    }
    const client = clients[0];
    if (clients.length !== 1 || client?.attributes?.['acc.local-bootstrap'] !== 'true')
      throw new Error('Refusing to modify an unrecognized Keycloak client');
    const mappers = z
      .array(z.object({ id: z.string(), name: z.string() }))
      .parse(await (await request(`/clients/${client.id}/protocol-mappers/models`)).json());
    for (const mapper of mappers.filter((mapper) => mapper.name === 'acc-task-scopes'))
      await request(`/clients/${client.id}/protocol-mappers/models/${mapper.id}`, 'DELETE');
    // MCP audience is opt-in via an optional scope; ordinary REST tokens stay REST-only.
    for (const mapper of mappers.filter((mapper) => mapper.name === 'acc-mcp-audience'))
      await request(`/clients/${client.id}/protocol-mappers/models/${mapper.id}`, 'DELETE');
    const scopeMappers = z
      .array(z.object({ id: z.string(), name: z.string() }))
      .parse(
        await (await request(`/client-scopes/${clientScopes[2]}/protocol-mappers/models`)).json(),
      );
    const mcpMapper = scopeMappers.find((mapper) => mapper.name === 'acc-mcp-audience');
    const audienceMapper = {
      name: 'acc-mcp-audience',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-audience-mapper',
      config: {
        'included.custom.audience': mcpAudience,
        'access.token.claim': 'true',
        'id.token.claim': 'false',
      },
    };
    await request(
      `/client-scopes/${clientScopes[2]}/protocol-mappers/models${mcpMapper ? `/${mcpMapper.id}` : ''}`,
      mcpMapper ? 'PUT' : 'POST',
      mcpMapper ? { ...audienceMapper, id: mcpMapper.id } : audienceMapper,
    );
    for (const scopeId of clientScopes.slice(0, 2))
      await request(`/clients/${client.id}/default-client-scopes/${scopeId}`, 'PUT');
    await request(`/clients/${client.id}/optional-client-scopes/${clientScopes[2]}`, 'PUT');
    const service = z
      .object({ id: z.uuid() })
      .parse(await (await request(`/clients/${client.id}/service-account-user`)).json());
    const secret = z
      .object({ value: z.string().min(16) })
      .parse(await (await request(`/clients/${client.id}/client-secret`)).json());
    const db = await pool.connect();
    let principalId: string;
    try {
      await db.query('BEGIN');
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('acc:local-bootstrap',0))");
      const existing = await db.query<{ principal_id: string; kind: string }>(
        'SELECT principal_id,kind FROM oidc_identities WHERE issuer=$1 AND subject=$2',
        [issuer, service.id],
      );
      principalId = existing.rows[0]?.principal_id ?? randomUUID();
      if (existing.rows[0] && existing.rows[0].kind !== 'AGENT')
        throw new Error('Existing identity is not an agent');
      if (!existing.rowCount) {
        await db.query("INSERT INTO principals(id,kind) VALUES ($1,'AGENT')", [principalId]);
        await db.query(
          "INSERT INTO oidc_identities(issuer,subject,principal_id,kind) VALUES ($1,$2,$3,'AGENT')",
          [issuer, service.id, principalId],
        );
      }
      await db.query(
        "INSERT INTO project_members(project_id,principal_id,scopes) VALUES ($1,$2,ARRAY['task:read','task:write']) ON CONFLICT DO NOTHING",
        [projectId, principalId],
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    agents.push({ clientId, clientSecret: secret.value, principalId });
  }
  return agents;
}
