import { Controller, Get, Post, Inject, Req, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { API_RUNTIME, type ApiRuntime } from '../context.ts';
import { AuthenticationGuard } from '../auth/guard.ts';
import type { ApiRequest } from '../auth/types.ts';
import { ApiError, success } from '../common/errors.ts';

@Controller('api/v1/projects')
@UseGuards(AuthenticationGuard)
export class ProjectsController {
  constructor(@Inject(API_RUNTIME) private runtime: ApiRuntime) {}
  @Get() async projects(@Req() req: ApiRequest) {
    return success(req, await this.runtime.queries.listProjects(req.identity!.id));
  }
  @Get(':projectId/context') async snapshot(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    return success(
      req,
      await this.runtime.context.snapshot(projectId, req.identity!.id, req.query),
    );
  }
  @Get(':projectId/events') async changes(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    return success(req, await this.runtime.context.changes(projectId, req.identity!.id, req.query));
  }
  @Get(':projectId/tasks') async tasks(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    return success(req, await this.runtime.queries.tasks(projectId, req.identity!.id, req.query));
  }
  @Get(':projectId/tasks/:taskId') async task(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    return success(req, await this.runtime.queries.task(projectId, req.identity!.id, taskId));
  }
  @Get(':projectId/agent-sessions') async sessions(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    return success(req, await this.runtime.queries.sessions(projectId, req.identity!.id));
  }
  private context(req: ApiRequest, projectId: string) {
    return { projectId: z.uuid().parse(projectId), principalId: req.identity!.id };
  }
  @Post(':projectId/tasks') async createTask(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    return success(
      req,
      await this.runtime.store.createTask(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        req.body,
      ),
    );
  }
  @Post(':projectId/tasks/:taskId/:command')
  async command(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('command') command: string,
  ) {
    const commands = {
      claim: 'claimTask',
      heartbeat: 'heartbeatClaim',
      release: 'releaseClaim',
      revoke: 'revokeClaim',
      work: 'updateWork',
      revise: 'reviseTask',
      transition: 'transitionTask',
      evidence: 'addEvidence',
      'accept-evidence': 'acceptEvidence',
      approve: 'approveTask',
      dependency: 'changeDependency',
    } as const;
    if (!Object.hasOwn(commands, command)) throw new ApiError(404, 'NOT_FOUND');
    const method = commands[command as keyof typeof commands];
    const context = this.context(req, projectId);
    z.uuid().parse(taskId);
    return success(
      req,
      await this.runtime.store[method](context, req.get('idempotency-key') ?? '', taskId, req.body),
    );
  }
  @Post(':projectId/agent-sessions') async registerSession(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    return success(
      req,
      await this.runtime.store.registerSession(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        req.body,
      ),
    );
  }
  @Post(':projectId/agents/:principalId/revoke') async revokeAgent(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('principalId') principalId: string,
  ) {
    z.uuid().parse(principalId);
    return success(
      req,
      await this.runtime.store.revokeAgentAccess(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        principalId,
        req.body,
      ),
    );
  }
  @Post(':projectId/agent-sessions/:sessionId/:command')
  async sessionCommand(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('command') command: string,
  ) {
    const context = this.context(req, projectId);
    z.uuid().parse(sessionId);
    if (command === 'heartbeat')
      return success(
        req,
        await this.runtime.store.heartbeatSession(
          context,
          req.get('idempotency-key') ?? '',
          sessionId,
          req.body,
        ),
      );
    if (command === 'end')
      return success(
        req,
        await this.runtime.store.endSession(
          context,
          req.get('idempotency-key') ?? '',
          sessionId,
          req.body,
        ),
      );
    throw new ApiError(404, 'NOT_FOUND');
  }
}
