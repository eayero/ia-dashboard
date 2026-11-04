import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfiguration } from '../config.ts';

async function main() {
  const config = loadConfiguration(process.env);
  if (
    config.nodeEnv !== 'development' ||
    !['localhost', '127.0.0.1'].includes(new URL(config.publicOrigin).hostname)
  )
    throw new Error('Local development required');
  const credentials = z
    .object({
      projectId: z.uuid(),
      agents: z.array(z.object({ mcpToken: z.string().min(1) })).min(1),
    })
    .parse(JSON.parse(await readFile('.cache/local-agents.json', 'utf8')));
  const token = credentials.agents[0]!.mcpToken;
  const client = new Client({ name: 'acc-compiled-smoke', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${config.port}/mcp`), {
        requestInit: {
          headers: { authorization: `Bearer ${token}` },
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
