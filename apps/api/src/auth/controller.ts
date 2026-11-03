import { Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { API_RUNTIME, type ApiRuntime } from '../context.ts';
import { emptyCommandSchema } from '@acc/contracts';
import { ApiError, success } from '../common/errors.ts';
import { AuthenticationGuard } from './guard.ts';
import type { ApiRequest } from './types.ts';

@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(API_RUNTIME) private runtime: ApiRuntime) {}
  @Get('login') login(@Req() req: ApiRequest, @Res() res: Response) {
    return this.runtime.auth.login(req, res);
  }
  @Get('callback') callback(@Req() req: ApiRequest, @Res() res: Response) {
    return this.runtime.auth.callback(req, res);
  }
  @Get('me')
  @UseGuards(AuthenticationGuard)
  me(@Req() req: ApiRequest) {
    return success(req, {
      principal: { id: req.identity!.id, kind: req.identity!.kind },
      csrfToken: req.identity!.mode === 'COOKIE' ? req.session.csrfToken : undefined,
    });
  }
  @Post('logout')
  @UseGuards(AuthenticationGuard)
  async logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    if (req.identity!.mode !== 'COOKIE') throw new ApiError(403, 'COOKIE_AUTH_REQUIRED');
    emptyCommandSchema.parse(req.body);
    await this.runtime.auth.logout(req, res);
    return success(req, { signedOut: true });
  }
}
