import { Controller, Get, Post, Inject, Req, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { API_RUNTIME, type ApiRuntime } from '../context.ts';
import { AuthenticationGuard } from '../auth/guard.ts';
import type { ApiRequest } from '../auth/types.ts';
import { success } from '../common/errors.ts';

@Controller('api/v1/projects/:projectId/requirements')
@UseGuards(AuthenticationGuard)
export class RequirementsController {
  constructor(@Inject(API_RUNTIME) private runtime: ApiRuntime) {}
  private context(req: ApiRequest, projectId: string) {
    return {
      projectId: z.uuid().parse(projectId),
      principalId: req.identity!.id,
      channel: req.identity!.mode === 'COOKIE' ? ('WEB' as const) : ('API' as const),
    };
  }
  @Get() async list(@Req() req: ApiRequest, @Param('projectId') projectId: string) {
    return success(
      req,
      await this.runtime.requirements.list(projectId, req.identity!.id, req.query),
    );
  }
  @Get(':requirementId') async detail(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('requirementId') id: string,
  ) {
    return success(req, await this.runtime.requirements.detail(projectId, req.identity!.id, id));
  }
  @Post() async create(@Req() req: ApiRequest, @Param('projectId') projectId: string) {
    return success(
      req,
      await this.runtime.store.createRequirement(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        req.body,
      ),
    );
  }
  @Post(':requirementId/revise') async revise(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('requirementId') id: string,
  ) {
    return success(
      req,
      await this.runtime.store.reviseRequirement(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        z.uuid().parse(id),
        req.body,
      ),
    );
  }
  @Post(':requirementId/approve') async approve(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('requirementId') id: string,
  ) {
    return success(
      req,
      await this.runtime.store.approveRequirement(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        z.uuid().parse(id),
        req.body,
      ),
    );
  }
  @Post(':requirementId/link') async link(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('requirementId') id: string,
  ) {
    return success(
      req,
      await this.runtime.store.linkRequirement(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        z.uuid().parse(id),
        req.body,
      ),
    );
  }
  @Post(':requirementId/evaluate-impact') async evaluate(
    @Req() req: ApiRequest,
    @Param('projectId') projectId: string,
    @Param('requirementId') id: string,
  ) {
    return success(
      req,
      await this.runtime.store.evaluateRequirementImpact(
        this.context(req, projectId),
        req.get('idempotency-key') ?? '',
        z.uuid().parse(id),
        req.body,
      ),
    );
  }
}
