import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { AuthConfiguration } from './auth.configuration';
import { AuthError } from './auth.errors';

export interface AccessTokenClaims {
  sub: string;
  organizationId: string;
  membershipId: string;
  deviceId: string;
  sessionId: string;
  jti: string;
  tokenUse: 'access';
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly configuration: AuthConfiguration,
  ) {}

  issueAccess(input: Omit<AccessTokenClaims, 'jti' | 'tokenUse'>): Promise<string> {
    return this.jwt.signAsync(
      { ...input, jti: randomUUID(), tokenUse: 'access' },
      {
        secret: this.configuration.accessSecret,
        algorithm: 'HS256',
        issuer: this.configuration.issuer,
        audience: this.configuration.audience,
        expiresIn: this.configuration.accessTtlSeconds,
      },
    );
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.configuration.accessSecret,
        algorithms: ['HS256'],
        issuer: this.configuration.issuer,
        audience: this.configuration.audience,
        clockTolerance: this.configuration.clockToleranceSeconds,
      });
      if (
        claims.tokenUse !== 'access' ||
        !claims.sub ||
        !claims.organizationId ||
        !claims.membershipId ||
        !claims.deviceId ||
        !claims.sessionId ||
        !claims.jti
      ) {
        throw new AuthError('TOKEN_INVALID');
      }
      return claims;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('TOKEN_INVALID');
    }
  }

  issueRefresh(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefresh(token) };
  }

  hashRefresh(token: string): string {
    return createHmac('sha256', this.configuration.refreshSecret).update(token).digest('hex');
  }
}
