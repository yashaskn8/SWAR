import { Injectable } from '@nestjs/common';

import {
  DeviceStatus,
  MembershipStatus,
  OrganizationRole,
  RefreshSessionStatus,
  UserStatus,
  type Device,
  type Organization,
  type OrganizationMembership,
  type RefreshSession,
  type User,
} from '../../generated/prisma/client';
import { TenantResourceNotFoundError } from '../../database/database.errors';
import {
  requireTenant,
  requireText,
  requireUuid,
  type TenantContext,
} from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../../database/transaction.service';

export interface CreateMembershipInput {
  userId: string;
  roles: OrganizationRole[];
  status?: MembershipStatus;
}

export interface RegisterDeviceInput {
  membershipId: string;
  devicePublicId: string;
  label?: string;
}

export interface CreateRefreshSessionInput {
  membershipId: string;
  deviceId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

@Injectable()
export class IdentityRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  createOrganization(input: {
    slug: string;
    displayName: string;
    status?: string;
  }): Promise<Organization> {
    return this.prisma.client.organization.create({
      data: {
        slug: requireText(input.slug, 'slug', 80),
        displayName: requireText(input.displayName, 'displayName', 160),
        status: requireText(input.status ?? 'ACTIVE', 'status', 32),
      },
    });
  }

  createUser(input: {
    emailCanonical: string;
    passwordHash: string;
    status?: UserStatus;
  }): Promise<User> {
    return this.prisma.client.user.create({
      data: {
        emailCanonical: requireText(input.emailCanonical.toLowerCase(), 'emailCanonical', 320),
        passwordHash: requireText(input.passwordHash, 'passwordHash', 255),
        status: input.status ?? UserStatus.ACTIVE,
      },
    });
  }

  createMembershipWithRoles(
    context: TenantContext,
    input: CreateMembershipInput,
  ): Promise<OrganizationMembership> {
    const organizationId = requireTenant(context);
    const userId = requireUuid(input.userId, 'userId');
    const roles = [...new Set(input.roles)];
    if (roles.length === 0) {
      throw new TenantResourceNotFoundError('Organization role');
    }
    return this.transactions.serializable(async (transaction) => {
      const organization = await transaction.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (organization === null || user === null) {
        throw new TenantResourceNotFoundError('Organization membership parent');
      }
      const membership = await transaction.organizationMembership.create({
        data: {
          organizationId,
          userId,
          status: input.status ?? MembershipStatus.ACTIVE,
          joinedAt: input.status === MembershipStatus.INVITED ? null : new Date(),
        },
      });
      await transaction.organizationMembershipRole.createMany({
        data: roles.map((role) => ({ organizationId, membershipId: membership.id, role })),
      });
      return membership;
    });
  }

  async findMembership(
    context: TenantContext,
    membershipId: string,
  ): Promise<OrganizationMembership> {
    const organizationId = requireTenant(context);
    const membership = await this.prisma.client.organizationMembership.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: requireUuid(membershipId, 'membershipId'),
        },
      },
    });
    if (membership === null) {
      throw new TenantResourceNotFoundError('Organization membership');
    }
    return membership;
  }

  async registerDevice(context: TenantContext, input: RegisterDeviceInput): Promise<Device> {
    const organizationId = requireTenant(context);
    await this.findMembership(context, input.membershipId);
    return this.prisma.client.device.create({
      data: {
        organizationId,
        membershipId: input.membershipId,
        devicePublicId: requireText(input.devicePublicId, 'devicePublicId', 128),
        label: input.label === undefined ? null : requireText(input.label, 'label', 120),
        status: DeviceStatus.ACTIVE,
      },
    });
  }

  async createRefreshSession(
    context: TenantContext,
    input: CreateRefreshSessionInput,
  ): Promise<RefreshSession> {
    const organizationId = requireTenant(context);
    requireUuid(input.membershipId, 'membershipId');
    requireUuid(input.deviceId, 'deviceId');
    requireUuid(input.familyId, 'familyId');
    if (input.expiresAt <= new Date()) {
      throw new TenantResourceNotFoundError('Future refresh-session expiry');
    }
    const device = await this.prisma.client.device.findUnique({
      where: {
        organizationId_id: { organizationId, id: input.deviceId },
      },
      select: { membershipId: true, status: true },
    });
    if (
      device === null ||
      device.membershipId !== input.membershipId ||
      device.status !== DeviceStatus.ACTIVE
    ) {
      throw new TenantResourceNotFoundError('Active device');
    }
    return this.prisma.client.refreshSession.create({
      data: {
        organizationId,
        membershipId: input.membershipId,
        deviceId: input.deviceId,
        tokenHash: requireText(input.tokenHash, 'tokenHash', 255),
        familyId: input.familyId,
        expiresAt: input.expiresAt,
      },
    });
  }

  async revokeRefreshSession(context: TenantContext, sessionId: string): Promise<RefreshSession> {
    const organizationId = requireTenant(context);
    const id = requireUuid(sessionId, 'sessionId');
    const result = await this.prisma.client.refreshSession.updateMany({
      where: { organizationId, id, status: RefreshSessionStatus.ACTIVE },
      data: { status: RefreshSessionStatus.REVOKED, revokedAt: new Date() },
    });
    if (result.count !== 1) {
      throw new TenantResourceNotFoundError('Active refresh session');
    }
    const session = await this.prisma.client.refreshSession.findUnique({ where: { id } });
    if (session === null) {
      throw new TenantResourceNotFoundError('Refresh session');
    }
    return session;
  }
}
