import {
  HttpStatus,
  Injectable,
  UnsupportedMediaTypeException,
  ValidationPipe,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ApiError } from '../errors/api-error';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    stopAtFirstError: false,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new ApiError('VALIDATION_FAILED', 'The request is invalid.', HttpStatus.BAD_REQUEST, {
        fields: errors
          .map(({ property }) => property)
          .filter(Boolean)
          .sort(),
      }),
  });
}

@Injectable()
export class JsonContentTypeMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      const contentType = request.headers['content-type'];
      const path = request.path.replace(/\/$/u, '');
      const multipartEnrollment =
        path === '/api/v1/voice-enrollments' &&
        typeof contentType === 'string' &&
        /^multipart\/form-data(?:\s*;|$)/iu.test(contentType);
      const liveKitWebhook =
        path === '/api/v1/media/livekit/webhook' &&
        typeof contentType === 'string' &&
        /^(?:application\/json|application\/webhook\+json)(?:\s*;|$)/iu.test(contentType);
      const json =
        typeof contentType === 'string' &&
        /^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/iu.test(contentType);
      if (!multipartEnrollment && !liveKitWebhook && !json) {
        throw new UnsupportedMediaTypeException();
      }
    }
    next();
  }
}
