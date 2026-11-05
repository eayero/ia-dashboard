import { Controller, Get, Post, Inject, Req, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { API_RUNTIME, type ApiRuntime } from '../context.ts';
import { AuthenticationGuard } from '../auth/guard.ts';
import type { ApiRequest } from '../auth/types.ts';
import { ApiError, success } from '../common/errors.ts';
import { taskCommands, sessionCommands } from './commands.ts';

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
  @Get(':projectId/repositories') async repositories(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    return success(
      req,
      await this.runtime.repositories.list(projectId, req.identity!.id, req.query),
    );
  }
  @Post(':projectId/repositories') async registerRepository(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    if (req.identity!.mode !== 'COOKIE') throw new ApiError(403, 'FORBIDDEN');
    return success(
      req,
      await this.runtime.store.registerRepository(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        req.body,
      ),
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
  @Get(':projectId/tasks/:taskId/time') async taskTime(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ) {
    return success(
      req,
      await this.runtime.queries.taskTime(projectId, req.identity!.id, taskId, req.query),
    );
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
    if (!Object.hasOwn(taskCommands, command)) throw new ApiError(404, 'NOT_FOUND');
    const { method } = taskCommands[command as keyof typeof taskCommands];
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
    if (!Object.hasOwn(sessionCommands, command)) throw new ApiError(404, 'NOT_FOUND');
    const { method } = sessionCommands[command as keyof typeof sessionCommands];
    return success(
      req,
      await this.runtime.store[method](
        context,
        req.get('idempotency-key') ?? '',
        sessionId,
        req.body,
      ),
    );
  }
}
