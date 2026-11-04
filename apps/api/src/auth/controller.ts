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
  @Get('session') async session(@Req() req: ApiRequest) {
    return success(req, await this.runtime.auth.session(req));
  }
  @Post('login') async login(@Req() req: ApiRequest) {
    await this.runtime.auth.login(req);
    return this.me(req);
  }
  @Post('password')
  @UseGuards(AuthenticationGuard)
  async password(@Req() req: ApiRequest) {
    await this.runtime.auth.changePassword(req);
    return this.me(req);
  }
  @Get('me')
  @UseGuards(AuthenticationGuard)
  me(@Req() req: ApiRequest) {
    return success(req, {
      principal: { id: req.identity!.id, kind: req.identity!.kind },
      user: req.identity!.user
        ? {
            username: req.identity!.user.username,
            displayName: req.identity!.user.displayName,
            systemRole: req.identity!.user.systemRole,
            mustChangePassword: req.identity!.user.mustChangePassword,
          }
        : undefined,
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
