import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { SafeLogger } from './safe-logger.service';
import {
  RequestContextService,
  resolveRequestId,
  type RequestWithContext,
} from './request-context.service';

export {
  RequestContextService,
  resolveRequestId,
  type RequestContextState,
  type RequestWithContext,
} from './request-context.service';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly context: RequestContextService,
    private readonly logger: SafeLogger,
  ) {}

  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const requestId = resolveRequestId(request.headers['x-request-id']);
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    const startedAt = process.hrtime.bigint();
    response.once('finish', () => {
      this.logger.event('log', 'http.request.completed', {
        requestId,
        method: request.method,
        path: request.originalUrl.split('?')[0] ?? '/',
        statusCode: response.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      });
    });
    this.context.run(
      { requestId, method: request.method, path: request.originalUrl.split('?')[0] ?? '/' },
      next,
    );
  }
}
