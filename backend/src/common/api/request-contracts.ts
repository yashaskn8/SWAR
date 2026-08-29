import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../errors/api-error';

const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

export function requireIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !idempotencyKeyPattern.test(value)) {
    throw new ApiError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required.',
      HttpStatus.BAD_REQUEST,
      { fields: ['idempotency-key'] },
    );
  }
  return value;
}

export function requireSingleHeader(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'The request is invalid.', HttpStatus.BAD_REQUEST, {
      fields: [name],
    });
  }
  return value;
}
