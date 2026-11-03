import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { API_RUNTIME, type ApiRuntime } from '../context.ts';
import { ApiError } from '../common/errors.ts';
import type { ApiRequest } from './types.ts';

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(@Inject(API_RUNTIME) private runtime: ApiRuntime) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    req.identity = await this.runtime.auth.authenticate(req);
    const mutates = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (req.identity.mode === 'COOKIE' && mutates) this.runtime.auth.verifyCsrf(req);
    if (req.identity.mode === 'BEARER') {
      if (!req.identity.scopes.includes(mutates ? 'task:write' : 'task:read'))
        throw new ApiError(403, 'FORBIDDEN');
      if (req.get('origin') && req.get('origin') !== this.runtime.config.publicOrigin)
        throw new ApiError(403, 'ORIGIN_FORBIDDEN');
    }
    if (mutates && !req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED');
    return true;
  }
}
