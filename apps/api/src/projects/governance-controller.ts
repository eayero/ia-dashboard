import { Controller, Get, Post, Inject, Req, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { API_RUNTIME, type ApiRuntime } from '../context.ts';
import type { ApiRequest } from '../auth/types.ts';
import { ApiError, success } from '../common/errors.ts';
import { AuthenticationGuard } from '../auth/guard.ts';
import type { GovernanceOperation } from '../../../../packages/db/src/governance.ts';
@Controller('api/v1/projects/:projectId')
@UseGuards(AuthenticationGuard)
export class GovernanceController {
  constructor(@Inject(API_RUNTIME) private runtime: ApiRuntime) {}
  private async command(
    req: ApiRequest,
    projectId: string,
    id: string | null,
    op: GovernanceOperation,
  ) {
    const human = [
      'resolveQuestion',
      'changeQuestionStatus',
      'linkQuestion',
      'approveDecision',
      'linkDecision',
      'evaluateDecisionImpact',
    ].includes(op);
    if (human && req.identity!.mode !== 'COOKIE') throw new ApiError(403, 'FORBIDDEN');
    const context = {
        projectId: z.uuid().parse(projectId),
        principalId: req.identity!.id,
        channel: req.identity!.mode === 'COOKIE' ? ('WEB' as const) : ('API' as const),
      },
      key = req.get('idempotency-key') ?? '';
    const result =
      op === 'createQuestion' || op === 'createDecision'
        ? await this.runtime.store[op](context, key, req.body)
        : await this.runtime.store[op](context, key, z.uuid().parse(id), req.body);
    return success(req, result);
  }
  @Get('questions') async questions(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Query() q: unknown,
  ) {
    return success(r, await this.runtime.governance.list(p, r.identity!.id, 'questions', q));
  }
  @Get('questions/:entityId') async question(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return success(r, await this.runtime.governance.detail(p, r.identity!.id, 'questions', id));
  }
  @Get('decisions') async decisions(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Query() q: unknown,
  ) {
    return success(r, await this.runtime.governance.list(p, r.identity!.id, 'decisions', q));
  }
  @Get('decisions/:entityId') async decision(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return success(r, await this.runtime.governance.detail(p, r.identity!.id, 'decisions', id));
  }
  @Get('inbox') async inbox(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Query() q: Record<string, unknown>,
  ) {
    return success(
      r,
      await this.runtime.governance.list(p, r.identity!.id, 'questions', { ...q, status: 'OPEN' }),
    );
  }
  @Post('questions') createQ(@Req() r: ApiRequest, @Param('projectId') p: string) {
    return this.command(r, p, null, 'createQuestion');
  }
  @Post('questions/:entityId/revise') reviseQ(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return this.command(r, p, id, 'reviseQuestion');
  }
  @Post('questions/:entityId/answer') answer(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return this.command(r, p, id, 'answerQuestion');
  }
  @Post('questions/:entityId/resolve') resolve(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return this.command(r, p, id, 'resolveQuestion');
  }
  @Post('questions/:entityId/status') status(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return this.command(r, p, id, 'changeQuestionStatus');
  }
  @Post('questions/:entityId/links') linkQ(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return this.command(r, p, id, 'linkQuestion');
  }
  @Post('decisions') createD(@Req() r: ApiRequest, @Param('projectId') p: string) {
    return this.command(r, p, null, 'createDecision');
  }
  @Post('decisions/:entityId/revise') reviseD(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return this.command(r, p, id, 'reviseDecision');
  }
  @Post('decisions/:entityId/approve') approve(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return this.command(r, p, id, 'approveDecision');
  }
  @Post('decisions/:entityId/links') linkD(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return this.command(r, p, id, 'linkDecision');
  }
  @Post('decisions/:entityId/evaluate-impact') impact(
    @Req() r: ApiRequest,
    @Param('projectId') p: string,
    @Param('entityId') id: string,
  ) {
    return this.command(r, p, id, 'evaluateDecisionImpact');
  }
}
