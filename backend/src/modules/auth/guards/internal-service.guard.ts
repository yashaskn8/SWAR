import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { InternalServiceAuthenticatorService } from '../internal-service-authenticator.service';
import {
  INTERNAL_SERVICE_NAME,
  type InternalServiceName,
} from '../decorators/internal-service.decorator';

@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(
    private readonly authenticator: InternalServiceAuthenticatorService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    const serviceName = request.headers['x-swar-service'];
    const expectedService = this.reflector.getAllAndOverride<InternalServiceName>(
      INTERNAL_SERVICE_NAME,
      [context.getHandler(), context.getClass()],
    );
    if (expectedService === undefined) throw new Error('Internal service guard is not scoped.');
    this.authenticator.authenticate(
      Array.isArray(authorization) ? undefined : authorization,
      Array.isArray(serviceName) ? undefined : serviceName,
      expectedService,
    );
    return true;
  }
}
