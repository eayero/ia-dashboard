import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfiguration } from '../config.ts';

async function main() {
  const config = loadConfiguration(process.env);
  const issuer = new URL(config.issuer);
  if (config.nodeEnv !== 'development' || !['localhost', '127.0.0.1'].includes(issuer.hostname))
    throw new Error('Local development required');
  const credentials = z
    .object({
      issuer: z.string(),
      projectId: z.uuid(),
      agents: z
        .array(
          z.object({
            clientId: z.enum(['acc-local-agent-a', 'acc-local-agent-b']),
            clientSecret: z.string().min(16),
          }),
        )
        .min(1),
    })
    .parse(JSON.parse(await readFile('.cache/local-agents.json', 'utf8')));
  if (credentials.issuer !== config.issuer) throw new Error('Local issuer mismatch');
  const agent = credentials.agents[0]!;
  const tokenResponse = await fetch(`${config.issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: agent.clientId,
      client_secret: agent.clientSecret,
      scope: 'acc:mcp',
      resource: `${config.publicOrigin}/mcp`,
    }),
  });
  if (!tokenResponse.ok) throw new Error('Local token issuance failed');
  const token = z.object({ access_token: z.string().min(1) }).parse(await tokenResponse.json());
  const client = new Client({ name: 'acc-compiled-smoke', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${config.port}/mcp`), {
        requestInit: {
          headers: { authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(15000),
        },
      }),
    );
    const tools = await client.listTools();
    const context = await client.callTool({
      name: 'acc_get_context',
      arguments: { projectId: credentials.projectId, query: { limit: 100 } },
    });
    if (context.isError) throw new Error('Context unavailable');
    const snapshot = z
      .object({ data: z.object({ complete: z.literal(true), changesCursor: z.string() }) })
      .parse(context.structuredContent);
    const delta = await client.callTool({
      name: 'acc_get_changes',
      arguments: {
        projectId: credentials.projectId,
        query: { cursor: snapshot.data.changesCursor },
      },
    });
    if (delta.isError) throw new Error('Delta unavailable');
    console.log(
      JSON.stringify({
        client: 'official-typescript-sdk',
        tools: tools.tools.length,
        context: true,
        delta: true,
      }),
    );
  } finally {
    await client.close();
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => {
    console.error('MCP smoke failed. Check local bootstrap, API and configuration.');
    process.exitCode = 1;
  });
}
