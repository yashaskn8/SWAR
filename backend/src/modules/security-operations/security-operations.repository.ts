import { Injectable } from '@nestjs/common';

import {
  decodeTimeCursor,
  encodeTimeCursor,
  pageLimit,
  type PageRequest,
} from '../../database/pagination';
import { TenantResourceNotFoundError } from '../../database/database.errors';
import { requireTenant, requireUuid, type TenantContext } from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SecurityOperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveAlerts(context: TenantContext, page: PageRequest) {
    const organizationId = requireTenant(context);
    const limit = pageLimit(page.limit);
    const cursor = decodeTimeCursor(page.cursor);
    const records = await this.prisma.client.alert.findMany({
      where: {
        organizationId,
        status: { in: ['PENDING', 'DELIVERED'] },
        acknowledgedAt: null,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { createdAt: { lt: cursor.timestamp } },
                { createdAt: cursor.timestamp, id: { lt: cursor.id } },
              ],
            }),
      },
      include: { riskEvent: true, intervention: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasNextPage = records.length > limit;
    const items = hasNextPage ? records.slice(0, limit) : records;
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasNextPage && last !== undefined
          ? encodeTimeCursor({ timestamp: last.createdAt, id: last.id })
          : null,
    };
  }

  async acknowledgeAlert(context: TenantContext, alertId: string, membershipId: string) {
    const organizationId = requireTenant(context);
    const id = requireUuid(alertId, 'alertId');
    await this.prisma.client.alert.updateMany({
      where: { organizationId, id, acknowledgedAt: null },
      data: {
        acknowledgedAt: new Date(),
        acknowledgedByMembershipId: requireUuid(membershipId, 'membershipId'),
      },
    });
    const alert = await this.prisma.client.alert.findUnique({
      where: { organizationId_id: { organizationId, id } },
    });
    if (alert === null) throw new TenantResourceNotFoundError('Alert');
    return alert;
  }

  async listSecurityEvents(context: TenantContext, page: PageRequest & { callId?: string }) {
    const organizationId = requireTenant(context);
    const limit = pageLimit(page.limit);
    const cursor = decodeTimeCursor(page.cursor);
    const records = await this.prisma.client.riskEvent.findMany({
      where: {
        organizationId,
        ...(page.callId === undefined ? {} : { callId: requireUuid(page.callId, 'callId') }),
        ...(cursor === null
          ? {}
          : {
              OR: [
                { occurredAt: { lt: cursor.timestamp } },
                { occurredAt: cursor.timestamp, id: { lt: cursor.id } },
              ],
            }),
      },
      include: { interventions: true },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasNextPage = records.length > limit;
    const items = hasNextPage ? records.slice(0, limit) : records;
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasNextPage && last !== undefined
          ? encodeTimeCursor({ timestamp: last.occurredAt, id: last.id })
          : null,
    };
  }

  async dashboardSummary(context: TenantContext) {
    const organizationId = requireTenant(context);
    const [activeCalls, unacknowledgedAlerts, activeInterventions, riskStates] = await Promise.all([
      this.prisma.client.call.count({
        where: { organizationId, status: { in: ['AUTHORIZED', 'ACTIVE', 'ENDING'] } },
      }),
      this.prisma.client.alert.count({
        where: {
          organizationId,
          status: { in: ['PENDING', 'DELIVERED'] },
          acknowledgedAt: null,
        },
      }),
      this.prisma.client.intervention.count({
        where: {
          organizationId,
          status: { in: ['REQUIRED', 'ACKNOWLEDGED', 'IN_PROGRESS'] },
        },
      }),
      this.prisma.client.riskEvent.groupBy({
        by: ['state'],
        where: { organizationId },
        _count: { _all: true },
      }),
    ]);
    return {
      activeCalls,
      unacknowledgedAlerts,
      activeInterventions,
      riskEventsByState: Object.fromEntries(
        riskStates.map((entry) => [entry.state, entry._count._all]),
      ),
    };
  }
}
