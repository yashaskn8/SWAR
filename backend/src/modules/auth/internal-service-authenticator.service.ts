import { createHash, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigurationService } from '../../config/configuration';
import { AuthError } from './auth.errors';
import type { InternalServiceName } from './decorators/internal-service.decorator';

@Injectable()
export class InternalServiceAuthenticatorService {
  constructor(private readonly configuration: ConfigurationService) {}

  authenticate(
    authorization: string | undefined,
    serviceName: string | undefined,
    expectedService: InternalServiceName,
  ): void {
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expected =
      expectedService === 'swar-ml'
        ? this.configuration.values.secrets.mlInternalSecret
        : this.configuration.values.secrets.verificationCallbackSecret;
    const suppliedHash = createHash('sha256').update(supplied).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    if (
      serviceName !== expectedService ||
      supplied.length === 0 ||
      !timingSafeEqual(suppliedHash, expectedHash)
    ) {
      throw new AuthError('TOKEN_INVALID');
    }
  }
}
