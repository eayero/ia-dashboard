import { Controller, Get, Post, Inject, Req, Param, UseGuards } from '@nestjs/common';
import { API_RUNTIME, type ApiRuntime } from '../context.ts';
import { AuthenticationGuard } from './guard.ts';
import type { ApiRequest } from './types.ts';
import { success } from '../common/errors.ts';
import { emptyCommandSchema } from '@acc/contracts';

@Controller('api/v1/admin')
@UseGuards(AuthenticationGuard)
export class AccountsController {
  constructor(@Inject(API_RUNTIME) private runtime: ApiRuntime) {}
  @Get('users') async users(@Req() req: ApiRequest) {
    return success(req, await this.runtime.accounts.users(req.identity!));
  }
  @Post('users') async create(@Req() req: ApiRequest) {
    return success(req, await this.runtime.accounts.createUser(req.identity!, req.body));
  }
  @Post('users/:id/password') async password(@Req() req: ApiRequest, @Param('id') id: string) {
    return success(req, await this.runtime.accounts.resetPassword(req.identity!, id, req.body));
  }
  @Post('users/:id/status') async status(@Req() req: ApiRequest, @Param('id') id: string) {
    return success(req, await this.runtime.accounts.status(req.identity!, id, req.body));
  }
  @Post('users/:id/projects/:projectId') async membership(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Param('projectId') projectId: string,
  ) {
    return success(
      req,
      await this.runtime.accounts.membership(req.identity!, id, projectId, req.body),
    );
  }
  @Get('agents') async agents(@Req() req: ApiRequest) {
    return success(req, await this.runtime.accounts.agents(req.identity!));
  }
  @Post('agents') async agent(@Req() req: ApiRequest) {
    return success(req, await this.runtime.accounts.createAgent(req.identity!, req.body));
  }
  @Post('agents/:id/revoke') async revoke(@Req() req: ApiRequest, @Param('id') id: string) {
    emptyCommandSchema.parse(req.body);
    return success(req, await this.runtime.accounts.revokeCredential(req.identity!, id));
  }
}
