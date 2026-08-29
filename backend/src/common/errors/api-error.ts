import { HttpException, type HttpStatus } from '@nestjs/common';

export type SafeErrorDetails = Record<string, string | string[]>;

export class ApiError extends HttpException {
  readonly code: string;
  readonly safeMessage: string;
  readonly details: SafeErrorDetails | undefined;

  constructor(code: string, message: string, status: HttpStatus, details?: SafeErrorDetails) {
    super({ code, message, ...(details === undefined ? {} : { details }) }, status);
    this.code = code;
    this.safeMessage = message;
    this.details = details;
  }
}
