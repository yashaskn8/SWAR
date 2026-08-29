import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../src/app.module';
import { configureApplication } from '../../../src/bootstrap';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  DeviceStatus,
  MembershipStatus,
  OrganizationRole,
  UserStatus,
} from '../../../src/generated/prisma/client';
import { PasswordService } from '../../../src/modules/auth/password.service';
import type { AuthSessionResponse } from '../../../src/modules/auth/auth.contracts';
import { RefreshSessionRepository } from '../../../src/modules/auth/refresh-session.repository';
import { TokenService } from '../../../src/modules/auth/token.service';

const runNative = process.env.SWAR_RUN_AUTH_TESTS === 'true';
const suite = runNative ? describe : describe.skip;

suite('Phase G native authentication integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let tokens: TokenService;
  let sessions: RefreshSessionRepository;
  let endpoint: string;
  const password = 'correct horse battery staple';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    endpoint = await app.getUrl();
    prisma = app.get(PrismaService);
    passwords = app.get(PasswordService);
    tokens = app.get(TokenService);
    sessions = app.get(RefreshSessionRepository);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function provision(input: {
    slug: string;
    email: string;
    device: string;
    role?: OrganizationRole;
    userId?: string;
  }) {
    const organization = await prisma.client.organization.create({
      data: { slug: input.slug, displayName: `Test ${input.slug}`, status: 'ACTIVE' },
    });
    const user =
      input.userId === undefined
        ? await prisma.client.user.create({
            data: {
              emailCanonical: input.email,
              passwordHash: await passwords.hash(password),
              status: UserStatus.ACTIVE,
            },
          })
        : await prisma.client.user.findUniqueOrThrow({ where: { id: input.userId } });
    const membership = await prisma.client.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        status: MembershipStatus.ACTIVE,
        joinedAt: new Date(),
      },
    });
    await prisma.client.organizationMembershipRole.create({
      data: {
        organizationId: organization.id,
        membershipId: membership.id,
        role: input.role ?? OrganizationRole.MEMBER,
      },
    });
    const device = await prisma.client.device.create({
      data: {
        organizationId: organization.id,
        membershipId: membership.id,
        devicePublicId: input.device,
        status: DeviceStatus.ACTIVE,
      },
    });
    return { organization, user, membership, device };
  }

  function login(slug: string, email: string, device: string, suppliedPassword = password) {
    return request(endpoint)
      .post('/api/v1/auth/sessions')
      .send({ organizationSlug: slug, email, devicePublicId: device, password: suppliedPassword });
  }

  it('logs in, rotates once, detects replay, revokes the family, logs out, and records non-sensitive audit actions', async () => {
    await provision({
      slug: 'tenant-a',
      email: 'member-a@example.invalid',
      device: 'device-a',
      role: OrganizationRole.SECURITY_ANALYST,
    });
    const loggedIn = await login('tenant-a', 'member-a@example.invalid', 'device-a').expect(200);
    const loggedInBody = loggedIn.body as AuthSessionResponse;
    expect(loggedInBody).toMatchObject({ tokenType: 'Bearer', expiresIn: 300 });
    expect(loggedInBody.accessToken).not.toContain('member-a@example.invalid');
    const rotated = await request(endpoint)
      .post('/api/v1/auth/sessions/refresh')
      .send({ refreshToken: loggedInBody.refreshToken })
      .expect(200);
    const rotatedBody = rotated.body as AuthSessionResponse;
    expect(rotatedBody.refreshToken).not.toBe(loggedInBody.refreshToken);
    const replay = await request(endpoint)
      .post('/api/v1/auth/sessions/refresh')
      .send({ refreshToken: loggedInBody.refreshToken })
      .expect(401);
    expect(replay.body as { code: string }).toMatchObject({ code: 'REFRESH_REUSE_DETECTED' });
    await request(endpoint)
      .post('/api/v1/auth/sessions/refresh')
      .send({ refreshToken: rotatedBody.refreshToken })
      .expect(401);

    const secondLogin = await login('tenant-a', 'member-a@example.invalid', 'device-a').expect(200);
    const secondLoginBody = secondLogin.body as AuthSessionResponse;
    await request(endpoint)
      .post('/api/v1/auth/sessions/revoke')
      .send({ refreshToken: secondLoginBody.refreshToken })
      .expect(204);
    await request(endpoint)
      .post('/api/v1/auth/sessions/refresh')
      .send({ refreshToken: secondLoginBody.refreshToken })
      .expect(401);

    const actions = await prisma.client.auditLog.findMany({
      where: { organizationId: loggedInBody.principal.organizationId },
      select: { action: true, nonSensitiveMetadata: true },
    });
    expect(actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'auth.session.created',
        'auth.session.rotated',
        'auth.refresh.reuse-detected',
        'auth.session.revoked',
      ]),
    );
    expect(JSON.stringify(actions)).not.toContain('member-a@example.invalid');
    expect(JSON.stringify(actions)).not.toContain(loggedInBody.refreshToken);
  });

  it('returns generic failures for wrong credentials and disabled devices', async () => {
    const identity = await provision({
      slug: 'tenant-disabled',
      email: 'disabled@example.invalid',
      device: 'disabled-device',
    });
    const wrong = await login(
      'tenant-disabled',
      'disabled@example.invalid',
      'disabled-device',
      'not the password',
    ).expect(401);
    expect(wrong.body as { code: string }).toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    await prisma.client.device.update({
      where: { id: identity.device.id },
      data: { status: DeviceStatus.REVOKED, revokedAt: new Date() },
    });
    const disabled = await login(
      'tenant-disabled',
      'disabled@example.invalid',
      'disabled-device',
    ).expect(401);
    expect(disabled.body as { code: string }).toMatchObject({ code: 'AUTHENTICATION_FAILED' });
  });

  it('selects the verified membership for a multi-organization user and rejects an expired refresh session', async () => {
    const first = await provision({
      slug: 'multi-one',
      email: 'multi@example.invalid',
      device: 'multi-device-one',
    });
    const second = await provision({
      slug: 'multi-two',
      email: 'multi@example.invalid',
      device: 'multi-device-two',
      userId: first.user.id,
      role: OrganizationRole.ADMIN,
    });
    const response = await login('multi-two', 'multi@example.invalid', 'multi-device-two').expect(
      200,
    );
    const responseBody = response.body as AuthSessionResponse;
    expect(responseBody.principal.organizationId).toBe(second.organization.id);
    const tokenHash = tokens.hashRefresh(responseBody.refreshToken);
    const now = Date.now();
    await prisma.client.refreshSession.update({
      where: { tokenHash },
      data: { issuedAt: new Date(now - 7_200_000), expiresAt: new Date(now - 3_600_000) },
    });
    const expired = await request(endpoint)
      .post('/api/v1/auth/sessions/refresh')
      .send({ refreshToken: responseBody.refreshToken })
      .expect(401);
    expect(expired.body as { code: string }).toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('reloads current roles and active state instead of trusting access-token role claims', async () => {
    const identity = await provision({
      slug: 'role-change',
      email: 'roles@example.invalid',
      device: 'roles-device',
      role: OrganizationRole.ADMIN,
    });
    const response = await login('role-change', 'roles@example.invalid', 'roles-device').expect(
      200,
    );
    const responseBody = response.body as AuthSessionResponse;
    const claims = await tokens.verifyAccess(responseBody.accessToken);
    expect((await sessions.findPrincipal(claims))?.roles).toEqual([OrganizationRole.ADMIN]);
    await prisma.client.organizationMembershipRole.deleteMany({
      where: { membershipId: identity.membership.id },
    });
    expect((await sessions.findPrincipal(claims))?.roles).toEqual([]);
    await prisma.client.user.update({
      where: { id: identity.user.id },
      data: { status: UserStatus.DISABLED },
    });
    await expect(sessions.findPrincipal(claims)).resolves.toBeNull();
  });
});
