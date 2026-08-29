import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  NotFoundException,
  PayloadTooLargeException,
  RequestTimeoutException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import {
  DatabaseUnavailableError,
  IdempotencyConflictError,
  InvalidPaginationCursorError,
  PersistenceConflictError,
  TenantResourceNotFoundError,
} from '../../database/database.errors';
import { AuthError } from '../../modules/auth/auth.errors';
import {
  DomainInputError,
  DomainProviderError,
  IllegalDomainTransitionError,
} from '../../modules/domain/domain.errors';
import { SafeLogger } from '../logging/safe-logger.service';
import {
  RequestContextService,
  resolveRequestId,
  type RequestWithContext,
} from '../logging/request-context.service';
import { ApiError, type SafeErrorDetails } from './api-error';

interface ErrorEnvelope {
  code: string;
  message: string;
  requestId: string;
  details?: SafeErrorDetails;
}

interface MappedError {
  status: number;
  code: string;
  message: string;
  details?: SafeErrorDetails;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly context: RequestContextService,
    private readonly logger: SafeLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const requestId =
      request.requestId ??
      this.context.getRequestId() ??
      resolveRequestId(request.headers['x-request-id']);
    response.setHeader('x-request-id', requestId);
    const mapped = this.map(exception);
    const envelope: ErrorEnvelope = {
      code: mapped.code,
      message: mapped.message,
      requestId,
      ...(mapped.details === undefined ? {} : { details: mapped.details }),
    };
    this.logger.event(mapped.status >= 500 ? 'error' : 'warn', 'http.request.failed', {
      code: mapped.code,
      requestId,
      method: request.method,
      path: request.originalUrl?.split('?')[0] ?? '/',
      statusCode: mapped.status,
    });
    response.status(mapped.status).json(envelope);
  }

  private map(exception: unknown): MappedError {
    if (
      typeof exception === 'object' &&
      exception !== null &&
      'status' in exception &&
      exception.status === 413
    ) {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is too large.',
      };
    }
    if (exception instanceof ApiError)
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.safeMessage,
        ...(exception.details === undefined ? {} : { details: exception.details }),
      };
    if (exception instanceof AuthError) return this.fromHttp(exception, exception.code);
    if (exception instanceof IdempotencyConflictError)
      return { status: HttpStatus.CONFLICT, code: exception.code, message: exception.message };
    if (exception instanceof InvalidPaginationCursorError)
      return {
        status: HttpStatus.BAD_REQUEST,
        code: exception.code,
        message: 'The pagination request is invalid.',
      };
    if (exception instanceof DomainInputError)
      return {
        status: HttpStatus.BAD_REQUEST,
        code: exception.code,
        message: 'The domain input is invalid.',
      };
    if (exception instanceof IllegalDomainTransitionError)
      return {
        status: HttpStatus.CONFLICT,
        code: exception.code,
        message: 'The requested state transition is not allowed.',
      };
    if (exception instanceof DomainProviderError)
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: exception.code,
        message: 'A required provider operation did not complete.',
      };
    if (exception instanceof PersistenceConflictError || exception instanceof ConflictException)
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'The request conflicts with current state.',
      };
    if (exception instanceof TenantResourceNotFoundError || exception instanceof NotFoundException)
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      };
    if (
      exception instanceof DatabaseUnavailableError ||
      exception instanceof ServiceUnavailableException
    )
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'A required dependency is unavailable.',
      };
    if (
      exception instanceof RequestTimeoutException ||
      exception instanceof GatewayTimeoutException
    )
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        code: 'DEPENDENCY_TIMEOUT',
        message: 'A required dependency timed out.',
      };
    if (exception instanceof PayloadTooLargeException)
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is too large.',
      };
    if (exception instanceof UnsupportedMediaTypeException)
      return {
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'The request content type is unsupported.',
      };
    if (exception instanceof BadRequestException)
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: 'The request is invalid.',
      };
    if (exception instanceof UnauthorizedException)
      return {
        status: HttpStatus.UNAUTHORIZED,
        code: 'AUTHENTICATION_FAILED',
        message: 'Authentication failed.',
      };
    if (exception instanceof ForbiddenException)
      return { status: HttpStatus.FORBIDDEN, code: 'FORBIDDEN', message: 'Access denied.' };
    if (exception instanceof HttpException) {
      if (exception.getStatus() === 429) {
        return {
          status: HttpStatus.TOO_MANY_REQUESTS,
          code: 'RATE_LIMITED',
          message: 'Too many requests.',
        };
      }
      return {
        status: exception.getStatus(),
        code: 'REQUEST_FAILED',
        message: 'The request could not be completed.',
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred.',
    };
  }

  private fromHttp(exception: HttpException, fallbackCode: string): MappedError {
    const response = exception.getResponse();
    if (typeof response === 'object' && response !== null) {
      const body = response as Record<string, unknown>;
      return {
        status: exception.getStatus(),
        code: typeof body.code === 'string' ? body.code : fallbackCode,
        message: typeof body.message === 'string' ? body.message : 'The request failed.',
      };
    }
    return { status: exception.getStatus(), code: fallbackCode, message: 'The request failed.' };
  }
}
