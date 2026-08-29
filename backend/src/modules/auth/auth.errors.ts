import { HttpException, HttpStatus } from '@nestjs/common';

export type AuthErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'AUTH_RATE_LIMITED'
  | 'TOKEN_INVALID'
  | 'REFRESH_REUSE_DETECTED'
  | 'FORBIDDEN';

const messages: Record<AuthErrorCode, string> = {
  AUTHENTICATION_FAILED: 'Authentication failed.',
  AUTH_RATE_LIMITED: 'Authentication temporarily unavailable.',
  TOKEN_INVALID: 'Authentication token is invalid.',
  REFRESH_REUSE_DETECTED: 'Refresh session is no longer valid.',
  FORBIDDEN: 'Access denied.',
};

const statuses: Record<AuthErrorCode, HttpStatus> = {
  AUTHENTICATION_FAILED: HttpStatus.UNAUTHORIZED,
  AUTH_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  TOKEN_INVALID: HttpStatus.UNAUTHORIZED,
  REFRESH_REUSE_DETECTED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
};

export class AuthError extends HttpException {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super({ code, message: messages[code] }, statuses[code]);
    this.code = code;
  }
}
