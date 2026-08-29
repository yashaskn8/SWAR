import { Injectable } from '@nestjs/common';
import { ConfigurationService } from '../../config/configuration';

@Injectable()
export class AuthConfiguration {
  readonly accessSecret: string;
  readonly refreshSecret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTtlSeconds: number;
  readonly clockToleranceSeconds: number;
  readonly refreshTtlSeconds: number;
  readonly loginMaximumAttempts: number;
  readonly loginWindowSeconds: number;

  constructor(configuration: ConfigurationService) {
    const auth = configuration.values.auth;
    this.accessSecret = auth.accessSecret;
    this.refreshSecret = auth.refreshSecret;
    this.issuer = auth.issuer;
    this.audience = auth.audience;
    this.accessTtlSeconds = auth.accessTtlSeconds;
    this.clockToleranceSeconds = auth.clockToleranceSeconds;
    this.refreshTtlSeconds = auth.refreshTtlSeconds;
    this.loginMaximumAttempts = auth.loginMaximumAttempts;
    this.loginWindowSeconds = auth.loginWindowSeconds;
  }
}
