import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditOutcome } from '../../generated/prisma/client';
import { AuditRepository } from '../audit/audit.repository';
import { AuthConfiguration } from './auth.configuration';
import type { AuthSessionResponse, LoginRequest } from './auth.contracts';
import { AuthError } from './auth.errors';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { PasswordService } from './password.service';
import { RefreshSessionRepository, type AuthPrincipal } from './refresh-session.repository';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly configuration: AuthConfiguration,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: RefreshSessionRepository,
    private readonly limiter: LoginAttemptLimiter,
    private readonly audit: AuditRepository,
  ) {}

  async login(
    input: LoginRequest,
    correlationId: string = randomUUID(),
  ): Promise<AuthSessionResponse> {
    const attemptKey = `${input.organizationSlug}:${input.email}:${input.devicePublicId}`;
    this.limiter.assertAllowed(attemptKey);
    const identity = await this.sessions.findLoginIdentity(input);
    const passwordMatches = await this.passwords.verify(
      identity?.passwordHash ?? null,
      input.password,
    );
    if (identity === null || !passwordMatches) {
      this.limiter.failed(attemptKey);
      throw new AuthError('AUTHENTICATION_FAILED');
    }
    this.limiter.succeeded(attemptKey);
    const refresh = this.tokens.issueRefresh();
    let principal: AuthPrincipal;
    try {
      principal = await this.sessions.create({
        identity,
        tokenHash: refresh.hash,
        familyId: randomUUID(),
        expiresAt: this.refreshExpiry(),
      });
    } catch {
      throw new AuthError('AUTHENTICATION_FAILED');
    }
    try {
      await this.recordAudit(principal, correlationId, 'auth.session.created', 'SUCCEEDED');
    } catch {
      await this.sessions.revokeFamily(refresh.hash);
      throw new AuthError('AUTHENTICATION_FAILED');
    }
    return this.response(principal, refresh.token);
  }

  async refresh(
    refreshToken: string,
    correlationId: string = randomUUID(),
  ): Promise<AuthSessionResponse> {
    const next = this.tokens.issueRefresh();
    const result = await this.sessions.rotate({
      currentHash: this.tokens.hashRefresh(refreshToken),
      nextHash: next.hash,
      expiresAt: this.refreshExpiry(),
    });
    if (result.kind === 'reuse') {
      await this.recordAudit(
        result.principal,
        correlationId,
        'auth.refresh.reuse-detected',
        'DENIED',
      );
      throw new AuthError('REFRESH_REUSE_DETECTED');
    }
    if (result.kind !== 'rotated') throw new AuthError('TOKEN_INVALID');
    try {
      await this.recordAudit(result.principal, correlationId, 'auth.session.rotated', 'SUCCEEDED');
    } catch {
      await this.sessions.revokeFamily(next.hash);
      throw new AuthError('TOKEN_INVALID');
    }
    return this.response(result.principal, next.token);
  }

  async logout(refreshToken: string, correlationId: string = randomUUID()): Promise<void> {
    const principal = await this.sessions.revokeFamily(this.tokens.hashRefresh(refreshToken));
    if (principal !== null) {
      await this.recordAudit(principal, correlationId, 'auth.session.revoked', 'SUCCEEDED');
    }
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.configuration.refreshTtlSeconds * 1_000);
  }

  private async response(
    principal: AuthPrincipal,
    refreshToken: string,
  ): Promise<AuthSessionResponse> {
    const accessToken = await this.tokens.issueAccess({
      sub: principal.userId,
      organizationId: principal.organizationId,
      membershipId: principal.membershipId,
      deviceId: principal.deviceId,
      sessionId: principal.sessionId,
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.configuration.accessTtlSeconds,
      principal,
    };
  }

  private async recordAudit(
    principal: AuthPrincipal,
    correlationId: string,
    action: string,
    outcome: 'SUCCEEDED' | 'DENIED' | 'FAILED',
  ): Promise<void> {
    await this.audit.append(
      { organizationId: principal.organizationId },
      {
        actorMembershipId: principal.membershipId,
        correlationId,
        action,
        targetType: 'refresh_session',
        targetId: principal.sessionId,
        outcome: AuditOutcome[outcome],
        nonSensitiveMetadata: { operation: action },
      },
    );
  }
}
