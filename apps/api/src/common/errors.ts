import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';
import { DomainError } from '@acc/domain';
import type { Response } from 'express';
import type { ApiRequest } from '../auth/types.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, details: unknown = undefined) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export function success(request: ApiRequest, data: unknown) {
  const meta: { requestId: string; version?: number; projectSeq?: string } = {
    requestId: request.requestId,
  };
  if (data && typeof data === 'object') {
    if ('version' in data && typeof data.version === 'number') meta.version = data.version;
    if ('projectSeq' in data && typeof data.projectSeq === 'string')
      meta.projectSeq = data.projectSeq;
  }
  return { data, meta };
}
export function errorResponse(error: unknown, request: ApiRequest) {
  let status = 500,
    code = 'INTERNAL_ERROR';
  let details: unknown;
  if (error instanceof ApiError) {
    status = error.status;
    code = error.code;
    details = error.details;
  } else if (error instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    details = error.issues.map((issue) => ({ path: issue.path, code: issue.code }));
  } else if (error && typeof error === 'object' && 'code' in error && error.code === 'AUTH_BUSY') {
    status = 429;
    code = 'AUTH_BUSY';
  } else if (error instanceof DomainError) {
    code = error.code;
    status =
      code === 'FORBIDDEN'
        ? 403
        : code.endsWith('_NOT_FOUND')
          ? 404
          : code === 'IDEMPOTENCY_KEY_REQUIRED'
            ? 400
            : [
                  'VERSION_CONFLICT',
                  'WORK_REVISION_CONFLICT',
                  'STALE_CLAIM',
                  'CLAIM_REQUIRED',
                  'TASK_ALREADY_CLAIMED',
                  'IDEMPOTENCY_KEY_REUSED',
                  'SESSION_INACTIVE',
                  'PROJECT_ARCHIVED',
                  'CLAIMS_PAUSED',
                  'APPROVAL_ALREADY_RESOLVED',
                  'TASK_ALREADY_VALIDATED',
                  'DEPENDENCY_EXISTS',
                  'REQUIREMENT_REVISION_CONFLICT',
                  'DECISION_REVISION_CONFLICT',
                  'DECISION_ALREADY_APPROVED',
                  'QUESTION_NOT_OPEN',
                  'REQUIREMENT_LINK_EXISTS',
                  'TASK_REQUIREMENT_REQUIRED',
                  'WORK_ALREADY_RUNNING',
                  'WORK_NOT_RUNNING',
                ].includes(code)
              ? 409
              : code === 'REQUEST_IN_PROGRESS'
                ? 409
                : 422;
  } else if (error instanceof HttpException) {
    status = error.getStatus();
    code =
      status === 404
        ? 'NOT_FOUND'
        : status === 401
          ? 'AUTH_REQUIRED'
          : status === 403
            ? 'FORBIDDEN'
            : 'HTTP_ERROR';
  } else if (error && typeof error === 'object' && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      status = 400;
      code = 'INVALID_JSON';
    }
    if (error.type === 'entity.too.large') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
    }
  }
  return {
    status,
    body: { error: { code, message: code, details, requestId: request.requestId } },
  };
}
export function sendError(error: unknown, request: ApiRequest, response: Response) {
  const result = errorResponse(error, request);
  response.status(result.status).json(result.body);
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    sendError(
      error,
      host.switchToHttp().getRequest<ApiRequest>(),
      host.switchToHttp().getResponse<Response>(),
    );
  }
}
