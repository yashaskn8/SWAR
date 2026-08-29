import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrganizationRole } from '../../generated/prisma/client';
import { ConfigurationService } from '../../config/configuration';
import { setValidTestEnvironment } from '../../../tests/test-environment';
import { AuthConfiguration } from './auth.configuration';
import { AccessSessionAuthenticator } from './access-session-authenticator.service';
import { AuthError } from './auth.errors';
import { AccessTokenGuard, type AuthenticatedRequest } from './guards/access-token.guard';
import { RolesGuard } from './guards/roles.guard';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { hasPermission, permissions } from './permissions';
import { PasswordService } from './password.service';
import { ResourceAuthorizationService } from './resource-authorization.service';
import type { RefreshSessionRepository } from './refresh-session.repository';
import { TokenService } from './token.service';

function authConfiguration(): AuthConfiguration {
  return new AuthConfiguration(new ConfigurationService(process.env));
}

describe('Phase G authentication primitives', () => {
  beforeEach(() => setValidTestEnvironment({ AUTH_LOGIN_MAX_ATTEMPTS: '2' }));

  it('hashes and verifies passwords with Argon2id without accepting a wrong password', async () => {
    const service = new PasswordService();
    await service.onModuleInit();
    const passwordHash = await service.hash('correct horse battery staple');
    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
    await expect(service.verify(passwordHash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(service.verify(passwordHash, 'wrong password')).resolves.toBe(false);
    await expect(service.verify(null, 'wrong password')).resolves.toBe(false);
  });

  it('issues scoped access JWTs and rejects wrong audience, expired, and malformed tokens', async () => {
    const configuration = authConfiguration();
    const jwt = new JwtService();
    const service = new TokenService(jwt, configuration);
    const identifiers = {
      sub: '01991a44-d792-7000-8000-000000000001',
      organizationId: '01991a44-d792-7000-8000-000000000002',
      membershipId: '01991a44-d792-7000-8000-000000000003',
      deviceId: '01991a44-d792-7000-8000-000000000004',
      sessionId: '01991a44-d792-7000-8000-000000000005',
    };
    const valid = await service.issueAccess(identifiers);
    await expect(service.verifyAccess(valid)).resolves.toMatchObject(identifiers);
    const wrongAudience = await jwt.signAsync(
      { ...identifiers, tokenUse: 'access', jti: crypto.randomUUID() },
      {
        secret: configuration.accessSecret,
        algorithm: 'HS256',
        issuer: configuration.issuer,
        audience: 'wrong',
        expiresIn: 60,
      },
    );
    const expired = await jwt.signAsync(
      { ...identifiers, tokenUse: 'access', jti: crypto.randomUUID() },
      {
        secret: configuration.accessSecret,
        algorithm: 'HS256',
        issuer: configuration.issuer,
        audience: configuration.audience,
        expiresIn: -1,
      },
    );
    const slightlyEarly = await jwt.signAsync(
      { ...identifiers, tokenUse: 'access', jti: crypto.randomUUID() },
      {
        secret: configuration.accessSecret,
        algorithm: 'HS256',
        issuer: configuration.issuer,
        audience: configuration.audience,
        expiresIn: 60,
        notBefore: 3,
      },
    );
    await expect(service.verifyAccess(wrongAudience)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
    await expect(service.verifyAccess(expired)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    await expect(service.verifyAccess(slightlyEarly)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
    process.env.JWT_CLOCK_TOLERANCE_SECONDS = '5';
    await expect(
      new TokenService(jwt, authConfiguration()).verifyAccess(slightlyEarly),
    ).resolves.toMatchObject(identifiers);
    await expect(service.verifyAccess('not-a-jwt')).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('uses different opaque refresh values and deterministic keyed digests', () => {
    const service = new TokenService(new JwtService(), authConfiguration());
    const first = service.issueRefresh();
    const second = service.issueRefresh();
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toBe(service.hashRefresh(first.token));
    expect(first.hash).not.toContain(first.token);
    expect(first.hash).toHaveLength(64);
  });

  it('enforces the role matrix and denies all protected resource classes cross-tenant', () => {
    expect(
      permissions.every((permission) => hasPermission([OrganizationRole.OWNER], permission)),
    ).toBe(true);
    expect(hasPermission([OrganizationRole.MEMBER], 'risk-policy.manage')).toBe(false);
    const authorization = new ResourceAuthorizationService();
    const principal = {
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      membershipId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      roles: [OrganizationRole.OWNER],
    };
    for (const permission of permissions) {
      expect(() => authorization.assert(principal, permission, crypto.randomUUID())).toThrow(
        AuthError,
      );
    }
    expect(() =>
      authorization.assert(principal, 'call.read', principal.organizationId),
    ).not.toThrow();
  });

  it('loads the principal through the access guard and applies current-role permissions', async () => {
    const principal = {
      userId: crypto.randomUUID(),
      organizationId: crypto.randomUUID(),
      membershipId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      roles: [OrganizationRole.SECURITY_ANALYST],
    };
    const request: AuthenticatedRequest = { headers: { authorization: 'Bearer signed-token' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext;
    const tokenVerifier = {
      verifyAccess: () =>
        Promise.resolve({
          sub: principal.userId,
          organizationId: principal.organizationId,
          membershipId: principal.membershipId,
          deviceId: principal.deviceId,
          sessionId: principal.sessionId,
        }),
    } as unknown as TokenService;
    const repository = {
      findPrincipal: () => Promise.resolve(principal),
    } as unknown as RefreshSessionRepository;
    const authenticator = new AccessSessionAuthenticator(tokenVerifier, repository);
    await expect(new AccessTokenGuard(authenticator).canActivate(context)).resolves.toBe(true);
    expect(request.principal).toEqual(principal);

    const analystReflector = {
      getAllAndOverride: (key: string) =>
        key === 'swar.required-permissions' ? ['audit.read'] : [],
    } as unknown as Reflector;
    expect(new RolesGuard(analystReflector).canActivate(context)).toBe(true);
    const adminReflector = {
      getAllAndOverride: (key: string) =>
        key === 'swar.required-permissions' ? ['membership.manage'] : [],
    } as unknown as Reflector;
    expect(() => new RolesGuard(adminReflector).canActivate(context)).toThrow(AuthError);
  });

  it('rate-limits repeated failures without retaining the raw identity', () => {
    const limiter = new LoginAttemptLimiter(authConfiguration());
    limiter.failed('private@example.invalid:device');
    limiter.failed('private@example.invalid:device');
    expect(() => limiter.assertAllowed('private@example.invalid:device')).toThrow(AuthError);
    limiter.succeeded('private@example.invalid:device');
    expect(() => limiter.assertAllowed('private@example.invalid:device')).not.toThrow();
  });

  it('fails startup for absent, default, shared, or malformed authentication configuration without echoing a secret', () => {
    delete process.env.JWT_ACCESS_SECRET;
    expect(() => authConfiguration()).toThrow(/JWT_ACCESS_SECRET/u);
    setValidTestEnvironment();
    process.env.JWT_ACCESS_SECRET = 'replace_with_random_access_token_secret';
    expect(() => authConfiguration()).toThrow(/JWT_ACCESS_SECRET/u);
    setValidTestEnvironment();
    process.env.JWT_REFRESH_SECRET = process.env.JWT_ACCESS_SECRET;
    expect(() => authConfiguration()).toThrow(/JWT_ACCESS_SECRET|JWT_REFRESH_SECRET/u);
    setValidTestEnvironment();
    process.env.JWT_ACCESS_TTL_SECONDS = 'not-a-number';
    expect(() => authConfiguration()).toThrow(/JWT_ACCESS_TTL_SECONDS/u);
  });
});
