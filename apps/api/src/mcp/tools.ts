import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  createTaskSchema,
  claimTaskSchema,
  heartbeatClaimSchema,
  updateWorkSchema,
  transitionTaskSchema,
  addEvidenceSchema,
  emptyCommandSchema,
  sessionHeartbeatSchema,
  revokeClaimSchema,
  taskQuerySchema,
  contextQuerySchema,
  eventsQuerySchema,
  createRequirementSchema,
  reviseRequirementSchema,
  requirementQuerySchema,
  startWorkSchema,
  pauseWorkSchema,
  taskTimeQuerySchema,
} from '@acc/contracts';
import type { ApiRuntime } from '../context.ts';
import type { ApiRequest } from '../auth/types.ts';
import { ApiError, errorResponse, success } from '../common/errors.ts';

export function createMcpServer(runtime: ApiRuntime, req: ApiRequest) {
  const server = new Server({ name: 'acc', version: '0.1.0' }, { capabilities: { tools: {} } });
  const project = { projectId: z.uuid() };
  const mutation = { ...project, idempotencyKey: z.string().trim().min(1).max(200) };
  const task = { ...mutation, taskId: z.uuid() };
  const context = (projectId: string) => ({ projectId, principalId: req.identity!.id });
  function tool<S extends z.ZodType>(
    name: string,
    description: string,
    schema: S,
    readOnly: boolean,
    execute: (input: z.output<S>) => Promise<unknown>,
  ) {
    return {
      name,
      readOnly,
      definition: {
        name,
        description,
        inputSchema: z.toJSONSchema(schema, { io: 'input' }) as Tool['inputSchema'],
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: !readOnly,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      execute: (input: unknown) => execute(schema.parse(input)),
    };
  }
  const tools = [
    tool(
      'acc_start_work',
      'Explicitly start recording work for the agent holding a live task claim. Does not infer past time.',
      z.strictObject({ ...task, input: startWorkSchema }),
      false,
      (a) => runtime.store.startWork(context(a.projectId), a.idempotencyKey, a.taskId, a.input),
    ),
    tool(
      'acc_pause_work',
      'Pause the current agent work interval. Claim/session expiry also bounds recorded duration.',
      z.strictObject({ ...task, input: pauseWorkSchema }),
      false,
      (a) => runtime.store.pauseWork(context(a.projectId), a.idempotencyKey, a.taskId, a.input),
    ),
    tool(
      'acc_get_task_time',
      'Read accumulated agent work by task, agent and calendar date in the requested IANA time zone.',
      z.strictObject({ ...project, taskId: z.uuid(), query: taskTimeQuerySchema }),
      true,
      (a) => runtime.queries.taskTime(a.projectId, req.identity!.id, a.taskId, a.query),
    ),
    tool(
      'acc_register_requirement',
      'Propose a versioned requirement by exact externalRef; human approval remains separate.',
      z.strictObject({ ...mutation, input: createRequirementSchema }),
      false,
      (a) => runtime.store.createRequirement(context(a.projectId), a.idempotencyKey, a.input),
    ),
    tool(
      'acc_revise_requirement',
      'Propose an immutable successor revision without replacing approved content.',
      z.strictObject({ ...mutation, requirementId: z.uuid(), input: reviseRequirementSchema }),
      false,
      (a) =>
        runtime.store.reviseRequirement(
          context(a.projectId),
          a.idempotencyKey,
          a.requirementId,
          a.input,
        ),
    ),
    tool(
      'acc_list_requirements',
      'List project requirements; follow nextCursor.',
      z.strictObject({ ...project, query: requirementQuerySchema }),
      true,
      (a) => runtime.requirements.list(a.projectId, req.identity!.id, a.query),
    ),
    tool(
      'acc_get_requirement',
      'Read requirement revisions, approval provenance, task links and impact history.',
      z.strictObject({ ...project, requirementId: z.uuid() }),
      true,
      (a) => runtime.requirements.detail(a.projectId, req.identity!.id, a.requirementId),
    ),
    tool(
      'acc_list_projects',
      'List projects accessible to the authenticated agent.',
      z.strictObject({}),
      true,
      () => runtime.queries.listProjects(req.identity!.id),
    ),
    tool(
      'acc_get_context',
      'Get a consistent context page. Finish all pages before using changesCursor.',
      z.strictObject({ ...project, query: contextQuerySchema }),
      true,
      (a) => runtime.context.snapshot(a.projectId, req.identity!.id, a.query),
    ),
    tool(
      'acc_get_changes',
      'Read ordered project events. Follow nextCursor, then retain changesCursor. Reconcile entity details.',
      z.strictObject({ ...project, query: eventsQuerySchema }),
      true,
      (a) => runtime.context.changes(a.projectId, req.identity!.id, a.query),
    ),
    tool(
      'acc_list_tasks',
      'List tasks before creating new work. Follow nextCursor.',
      z.strictObject({ ...project, query: taskQuerySchema }),
      true,
      (a) => runtime.queries.tasks(a.projectId, req.identity!.id, a.query),
    ),
    tool(
      'acc_get_task',
      'Read current task version, criteria, evidence, approvals and owned claim.',
      z.strictObject({ ...project, taskId: z.uuid() }),
      true,
      (a) => runtime.queries.task(a.projectId, req.identity!.id, a.taskId),
    ),
    tool(
      'acc_find_or_create_task',
      'List requirements first, then create BACKLOG work with nonempty requirementIds. Task and initial links commit atomically. Draft scope stays impact-pending; approved revisions become the initial baseline. Find by exact externalRef; an existing task is returned without changing its links. Reuse idempotencyKey for retries. Requirement approval and later impact review remain human actions.',
      z.strictObject({ ...mutation, input: createTaskSchema }),
      false,
      (a) => runtime.store.createTask(context(a.projectId), a.idempotencyKey, a.input),
    ),
    tool(
      'acc_register_session',
      'Explicitly register an ACC work session, independent of MCP transport. Reuse idempotencyKey for retries.',
      z.strictObject({ ...mutation, input: emptyCommandSchema }),
      false,
      (a) => runtime.store.registerSession(context(a.projectId), a.idempotencyKey, a.input),
    ),
    tool(
      'acc_heartbeat_session',
      'Renew ACC session only; does not renew task claims.',
      z.strictObject({ ...mutation, sessionId: z.uuid(), input: sessionHeartbeatSchema }),
      false,
      (a) =>
        runtime.store.heartbeatSession(
          context(a.projectId),
          a.idempotencyKey,
          a.sessionId,
          a.input,
        ),
    ),
    tool(
      'acc_end_session',
      'End an ACC session and invalidate its task claims.',
      z.strictObject({ ...mutation, sessionId: z.uuid(), input: revokeClaimSchema }),
      false,
      (a) => runtime.store.endSession(context(a.projectId), a.idempotencyKey, a.sessionId, a.input),
    ),
    tool(
      'acc_claim_task',
      'Acquire task ownership using a live ACC session and current task version.',
      z.strictObject({ ...task, input: claimTaskSchema }),
      false,
      (a) => runtime.store.claimTask(context(a.projectId), a.idempotencyKey, a.taskId, a.input),
    ),
    tool(
      'acc_heartbeat_task',
      'Renew a task claim using its current fencing token and version.',
      z.strictObject({ ...task, input: heartbeatClaimSchema }),
      false,
      (a) =>
        runtime.store.heartbeatClaim(context(a.projectId), a.idempotencyKey, a.taskId, a.input),
    ),
    tool(
      'acc_release_task',
      'Release an owned claim with its current fencing token and version.',
      z.strictObject({ ...task, input: heartbeatClaimSchema }),
      false,
      (a) => runtime.store.releaseClaim(context(a.projectId), a.idempotencyKey, a.taskId, a.input),
    ),
    tool(
      'acc_update_task',
      'Update implementation summary under a live owned claim. Does not change human scope or acceptance criteria.',
      z.strictObject({ ...task, input: updateWorkSchema }),
      false,
      (a) => runtime.store.updateWork(context(a.projectId), a.idempotencyKey, a.taskId, a.input),
    ),
    tool(
      'acc_transition_task',
      'Move through the full workflow, including DONE, cancellation and reopening. Server enforces technical evidence, dependencies, versions and claims. Human validation after DONE is separate.',
      z.strictObject({ ...task, input: transitionTaskSchema }),
      false,
      (a) =>
        runtime.store.transitionTask(context(a.projectId), a.idempotencyKey, a.taskId, a.input),
    ),
    tool(
      'acc_add_evidence',
      'Attach evidence to criteria and current work revision. Attaching does not constitute human acceptance.',
      z.strictObject({ ...task, input: addEvidenceSchema }),
      false,
      (a) => runtime.store.addEvidence(context(a.projectId), a.idempotencyKey, a.taskId, a.input),
    ),
  ];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => tool.definition),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const selected = tools.find((tool) => tool.name === request.params.name);
      if (!selected) throw new ApiError(404, 'TOOL_NOT_FOUND');
      if (request.params.task) throw new ApiError(400, 'MCP_TASKS_UNSUPPORTED');
      if (!selected.readOnly && !req.identity!.scopes.includes('task:write'))
        throw new ApiError(403, 'FORBIDDEN');
      const result = success(req, await selected.execute(request.params.arguments ?? {}));
      // JSON projection keeps text and structured content identical for dates/undefined.
      const text = JSON.stringify(result);
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: JSON.parse(text) as Record<string, unknown>,
      };
    } catch (error) {
      const body = errorResponse(error, req).body;
      const text = JSON.stringify(body);
      return {
        isError: true,
        content: [{ type: 'text' as const, text }],
        structuredContent: JSON.parse(text) as Record<string, unknown>,
      };
    }
  });
  return {
    server,
    requiredScope(body: unknown) {
      const parsed = CallToolRequestSchema.safeParse(body);
      const selected = parsed.success
        ? tools.find((tool) => tool.name === parsed.data.params.name)
        : undefined;
      return selected && !selected.readOnly ? 'task:write' : 'task:read';
    },
  };
}
