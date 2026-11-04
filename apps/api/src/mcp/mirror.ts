import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { loadConfiguration } from '../config.ts';

const config = loadConfiguration(process.env);
assert.equal(config.nodeEnv, 'development');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(config.publicOrigin).hostname));
const catalog = z
  .array(
    z.object({
      id: z.string(),
      title: z.string(),
      source: z.string(),
      context: z.string(),
      criteria: z.array(z.string()).min(1),
    }),
  )
  .parse(JSON.parse(await readFile('docs/acc-tasks.json', 'utf8')));
assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
for (const item of catalog) await readFile(item.source, 'utf8');
const credentials = z
  .object({ projectId: z.uuid(), agents: z.array(z.object({ mcpToken: z.string() })).min(1) })
  .parse(JSON.parse(await readFile('.cache/local-agents.json', 'utf8')));
const client = new Client({ name: 'acc-repository-mirror', version: '1.0.0' });
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({
    name,
    arguments: { projectId: credentials.projectId, ...args },
  });
  const envelope = result.structuredContent as { data?: unknown; error?: { code: string } };
  if (result.isError) throw new Error(`${name}: ${envelope.error?.code ?? 'MCP_ERROR'}`);
  return envelope.data as Record<string, unknown>;
}
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', config.publicOrigin), {
      requestInit: {
        headers: { authorization: `Bearer ${credentials.agents[0]!.mcpToken}` },
        signal: AbortSignal.timeout(20000),
      },
    }),
  );
  const tools = await client.listTools();
  // Complete every context page before retaining its delta cursor.
  let snapshot = await call('acc_get_context', { query: { limit: 100 } });
  while (!snapshot.complete) {
    assert.ok(snapshot.nextCursor);
    snapshot = await call('acc_get_context', {
      query: { limit: 100, cursor: snapshot.nextCursor },
    });
  }
  const changesCursor = snapshot.changesCursor;
  assert.equal(typeof changesCursor, 'string');
  const rows = [];
  for (const item of catalog) {
    const input = {
      title: `[${item.id}] ${item.title}`,
      workType: 'OTHER',
      externalRef: `repo:dashboard:${item.id}`,
      criteria: [
        {
          id: 'source',
          description: `Fuente: ${item.source}. Contexto documentado: ${item.context}`,
          required: false,
        },
        ...item.criteria.map((description, index) => ({
          id: `c${index + 1}`,
          description,
          required: true,
        })),
      ],
    };
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const args = { input, idempotencyKey: `repo-mirror:${item.id}:${digest}` };
    const created = await call('acc_find_or_create_task', args);
    const replay = await call('acc_find_or_create_task', args);
    assert.equal(replay.id, created.id);
    const task = await call('acc_get_task', { taskId: created.id });
    // Task detail wraps the entity; creation returns the task directly.
    const entity = (task.task ?? task) as Record<string, unknown>;
    assert.equal(entity.id, created.id);
    assert.equal(entity.title, input.title, `Conflicto de título: ${item.id}`);
    assert.deepEqual(entity.criteria, input.criteria, `Conflicto de criterios: ${item.id}`);
    rows.push({
      fileId: item.id,
      taskId: created.id,
      source: item.source,
      status: entity.status,
      replayVerified: true,
      readVerified: true,
    });
  }
  const delta = await call('acc_get_changes', { query: { cursor: changesCursor } });
  const report = {
    checkedAt: new Date().toISOString(),
    projectId: credentials.projectId,
    endpoint: new URL('/mcp', config.publicOrigin).href,
    tools: tools.tools.length,
    contextVerified: true,
    deltaVerified: Boolean(delta),
    tasks: rows,
  };
  await writeFile('docs/ACC_MIRROR_RESULT.json', JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      projectId: credentials.projectId,
      tasks: rows.length,
      replayVerified: true,
      readVerified: true,
      contextVerified: true,
      deltaVerified: true,
    }),
  );
} finally {
  await client.close();
}
