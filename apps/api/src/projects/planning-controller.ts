import { Controller, Get, Post, Inject, Req, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { API_RUNTIME, type ApiRuntime } from '../context.ts';
import { AuthenticationGuard } from '../auth/guard.ts';
import type { ApiRequest } from '../auth/types.ts';
import { ApiError, success } from '../common/errors.ts';

@Controller('api/v1/projects/:projectId')
@UseGuards(AuthenticationGuard)
export class PlanningController {
  constructor(@Inject(API_RUNTIME) private runtime: ApiRuntime) {}
  private context(req: ApiRequest, projectId: string) {
    if (req.identity!.mode !== 'COOKIE') throw new ApiError(403, 'FORBIDDEN');
    return {
      projectId: z.uuid().parse(projectId),
      principalId: req.identity!.id,
      channel: 'WEB' as const,
    };
  }
  @Get('iterations') async list(@Req() req: ApiRequest, @Param('projectId') projectId: string) {
    return success(
      req,
      await this.runtime.planning.iterations(projectId, req.identity!.id, req.query),
    );
  }
  @Get('participants') async participants(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    return success(
      req,
      await this.runtime.planning.participants(projectId, req.identity!.id, req.query),
    );
  }
  @Post('iterations') async create(@Req() req: ApiRequest, @Param('projectId') projectId: string) {
    return success(
      req,
      await this.runtime.store.createIteration(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        req.body,
      ),
    );
  }
  @Post('iterations/:iterationId/update') async update(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('iterationId') id: string,
  ) {
    return success(
      req,
      await this.runtime.store.updateIteration(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        z.uuid().parse(id),
        req.body,
      ),
    );
  }
  @Post('iterations/:iterationId/transition') async transition(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('iterationId') id: string,
  ) {
    return success(
      req,
      await this.runtime.store.transitionIteration(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        z.uuid().parse(id),
        req.body,
      ),
    );
  }
  @Post('requirements/:requirementId/sprint') async assign(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('requirementId') id: string,
  ) {
    return success(
      req,
      await this.runtime.store.assignRequirementSprint(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        z.uuid().parse(id),
        req.body,
      ),
    );
  }
  @Post('execution/prepare') async prepare(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
  ) {
    return success(
      req,
      await this.runtime.store.prepareSprintExecution(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        req.body,
      ),
    );
  }
}
