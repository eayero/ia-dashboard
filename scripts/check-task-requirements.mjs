import { readFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '../apps/api/test/mcp-client.ts';

const configuration = JSON.parse(await readFile('config/project.json', 'utf8'));
const credentials = JSON.parse(await readFile('.cache/local-agents.json', 'utf8'));
const projectId = configuration.agents.acc.projectId;
if (credentials.projectId !== projectId) throw new Error('Credential project mismatch');
const origin = process.env.PUBLIC_ORIGIN;
if (!origin || !['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('This audit uses the existing local ACC configuration');
const client = new Client({ name: 'acc-task-requirement-audit', version: '1.0.0' });
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', origin), {
      requestInit: { headers: { authorization: `Bearer ${credentials.agents[0].mcpToken}` } },
    }),
  );
  let cursor;
  const records = [];
  do {
    const result = await client.callTool({
      name: 'acc_get_context',
      arguments: { projectId, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
    });
    if (result.isError) throw new Error('ACC context unavailable');
    const page = result.structuredContent.data;
    records.push(...page.records);
    cursor = page.nextCursor;
    if (!cursor && !page.complete) throw new Error('Incomplete ACC snapshot');
  } while (cursor);
  const tasks = records.filter((r) => r.entityType === 'TASK').map((r) => r.data);
  const requirements = new Set(
    records.filter((r) => r.entityType === 'REQUIREMENT').map((r) => r.data.id),
  );
  const covered = new Set(
    records
      .filter((r) => r.entityType === 'REQUIREMENT_LINK' && requirements.has(r.data.requirementId))
      .map((r) => r.data.taskId),
  );
  const orphans = tasks.filter((t) => !covered.has(t.id));
  console.log(
    JSON.stringify({
      projectId,
      requirements: requirements.size,
      tasks: tasks.length,
      covered: tasks.length - orphans.length,
      orphans: orphans.map((t) => ({ id: t.id, publicId: t.publicId, title: t.title })),
    }),
  );
  if (orphans.length) process.exitCode = 1;
} finally {
  await client.close();
}
