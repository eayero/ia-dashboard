import { Controller, Get } from '@nestjs/common';
import { buildOpenApi } from './document.ts';
const document = buildOpenApi();
@Controller('api/v1')
export class OpenApiController {
  @Get('openapi.json') document() {
    return document;
  }
}
