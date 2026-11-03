import { Controller, Get, Inject, Req } from '@nestjs/common';
import { API_RUNTIME, type ApiRuntime } from '../context.ts';
import { ApiError, success } from '../common/errors.ts';
import type { ApiRequest } from '../auth/types.ts';
@Controller('api/v1/health')
export class HealthController {
  constructor(@Inject(API_RUNTIME) private runtime: ApiRuntime) {}
  @Get('live') live(@Req() req: ApiRequest) {
    return success(req, { status: 'UP' });
  }
  @Get('ready') async ready(@Req() req: ApiRequest) {
    try {
      await this.runtime.pool.query('SELECT 1');
      return success(req, { status: 'UP' });
    } catch {
      throw new ApiError(503, 'NOT_READY');
    }
  }
}
