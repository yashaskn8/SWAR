import { Injectable } from '@nestjs/common';

import {
  DeviceStatus,
  MembershipStatus,
  RefreshSessionStatus,
  UserStatus,
  type OrganizationRole,
} from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../../database/transaction.service';

export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  membershipId: string;
  deviceId: string;
  sessionId: string;
  roles: OrganizationRole[];
}

export interface LoginIdentity extends Omit<AuthPrincipal, 'sessionId'> {
  passwordHash: string;
}

export type RotationResult =
  | { kind: 'rotated'; principal: AuthPrincipal }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'reuse'; principal: AuthPrincipal };

@Injectable()
export class RefreshSessionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  async findLoginIdentity(input: {
    email: string;
    organizationSlug: string;
    devicePublicId: string;
  }): Promise<LoginIdentity | null> {
    const device = await this.prisma.client.device.findFirst({
      where: {
        devicePublicId: input.devicePublicId,
        status: DeviceStatus.ACTIVE,
        organization: { slug: input.organizationSlug, status: 'ACTIVE' },
        membership: {
          status: MembershipStatus.ACTIVE,
          user: { emailCanonical: input.email, status: UserStatus.ACTIVE },
        },
      },
      include: { membership: { include: { user: true, roles: true } } },
    });
    if (device === null) return null;
    return {
      userId: device.membership.user.id,
      organizationId: device.organizationId,
      membershipId: device.membershipId,
      deviceId: device.id,
      roles: device.membership.roles.map(({ role }) => role),
      passwordHash: device.membership.user.passwordHash,
    };
  }

  async create(input: {
    identity: LoginIdentity;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<AuthPrincipal> {
    return this.transactions.serializable(async (transaction) => {
      const device = await transaction.device.findFirst({
        where: {
          id: input.identity.deviceId,
          organizationId: input.identity.organizationId,
          membershipId: input.identity.membershipId,
          status: DeviceStatus.ACTIVE,
          membership: { status: MembershipStatus.ACTIVE, user: { status: UserStatus.ACTIVE } },
        },
        include: { membership: { include: { roles: true } } },
      });
      if (device === null) throw new Error('AUTH_IDENTITY_CHANGED');
      const session = await transaction.refreshSession.create({
        data: {
          organizationId: device.organizationId,
          membershipId: device.membershipId,
          deviceId: device.id,
          tokenHash: input.tokenHash,
          familyId: input.familyId,
          expiresAt: input.expiresAt,
        },
      });
      return {
        userId: input.identity.userId,
        organizationId: device.organizationId,
        membershipId: device.membershipId,
        deviceId: device.id,
        sessionId: session.id,
        roles: device.membership.roles.map(({ role }) => role),
      };
    });
  }

  rotate(input: {
    currentHash: string;
    nextHash: string;
    expiresAt: Date;
  }): Promise<RotationResult> {
    return this.transactions.serializable(async (transaction) => {
      const current = await transaction.refreshSession.findUnique({
        where: { tokenHash: input.currentHash },
        include: {
          device: true,
          membership: { include: { user: true, roles: true } },
        },
      });
      if (current === null) return { kind: 'invalid' };
      if (current.status !== RefreshSessionStatus.ACTIVE) {
        await transaction.refreshSession.updateMany({
          where: { familyId: current.familyId, status: RefreshSessionStatus.ACTIVE },
          data: { status: RefreshSessionStatus.REVOKED, revokedAt: new Date() },
        });
        return { kind: 'reuse', principal: this.toPrincipal(current, current.id) };
      }
      if (current.expiresAt <= new Date()) {
        await transaction.refreshSession.update({
          where: { id: current.id },
          data: { status: RefreshSessionStatus.EXPIRED, revokedAt: new Date() },
        });
        return { kind: 'expired' };
      }
      const valid =
        current.device.status === DeviceStatus.ACTIVE &&
        current.membership.status === MembershipStatus.ACTIVE &&
        current.membership.user.status === UserStatus.ACTIVE;
      if (!valid) {
        await transaction.refreshSession.updateMany({
          where: { familyId: current.familyId, status: RefreshSessionStatus.ACTIVE },
          data: { status: RefreshSessionStatus.REVOKED, revokedAt: new Date() },
        });
        return { kind: 'invalid' };
      }
      const transition = await transaction.refreshSession.updateMany({
        where: { id: current.id, status: RefreshSessionStatus.ACTIVE },
        data: { status: RefreshSessionStatus.ROTATED, rotatedAt: new Date() },
      });
      if (transition.count !== 1) {
        await transaction.refreshSession.updateMany({
          where: { familyId: current.familyId, status: RefreshSessionStatus.ACTIVE },
          data: { status: RefreshSessionStatus.REVOKED, revokedAt: new Date() },
        });
        return { kind: 'reuse', principal: this.toPrincipal(current, current.id) };
      }
      const next = await transaction.refreshSession.create({
        data: {
          organizationId: current.organizationId,
          membershipId: current.membershipId,
          deviceId: current.deviceId,
          tokenHash: input.nextHash,
          familyId: current.familyId,
          expiresAt: input.expiresAt,
        },
      });
      return {
        kind: 'rotated',
        principal: {
          userId: current.membership.userId,
          organizationId: current.organizationId,
          membershipId: current.membershipId,
          deviceId: current.deviceId,
          sessionId: next.id,
          roles: current.membership.roles.map(({ role }) => role),
        },
      };
    });
  }

  revokeFamily(tokenHash: string): Promise<AuthPrincipal | null> {
    return this.transactions.serializable(async (transaction) => {
      const session = await transaction.refreshSession.findUnique({
        where: { tokenHash },
        include: { membership: { include: { roles: true } } },
      });
      if (session === null) return null;
      await transaction.refreshSession.updateMany({
        where: { familyId: session.familyId, status: RefreshSessionStatus.ACTIVE },
        data: { status: RefreshSessionStatus.REVOKED, revokedAt: new Date() },
      });
      return this.toPrincipal(session, session.id);
    });
  }

  async findPrincipal(input: {
    sub: string;
    organizationId: string;
    membershipId: string;
    deviceId: string;
    sessionId: string;
  }): Promise<AuthPrincipal | null> {
    const session = await this.prisma.client.refreshSession.findFirst({
      where: {
        id: input.sessionId,
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        deviceId: input.deviceId,
        status: RefreshSessionStatus.ACTIVE,
        expiresAt: { gt: new Date() },
        device: { status: DeviceStatus.ACTIVE },
        membership: {
          userId: input.sub,
          status: MembershipStatus.ACTIVE,
          user: { status: UserStatus.ACTIVE },
        },
      },
      include: { membership: { include: { roles: true } } },
    });
    if (session === null) return null;
    return {
      userId: session.membership.userId,
      organizationId: session.organizationId,
      membershipId: session.membershipId,
      deviceId: session.deviceId,
      sessionId: session.id,
      roles: session.membership.roles.map(({ role }) => role),
    };
  }

  private toPrincipal(
    session: {
      id: string;
      organizationId: string;
      membershipId: string;
      deviceId: string;
      membership: { userId: string; roles: { role: OrganizationRole }[] };
    },
    sessionId: string,
  ): AuthPrincipal {
    return {
      userId: session.membership.userId,
      organizationId: session.organizationId,
      membershipId: session.membershipId,
      deviceId: session.deviceId,
      sessionId,
      roles: session.membership.roles.map(({ role }) => role),
    };
  }
}
