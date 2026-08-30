import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AlertChannel, AlertStatus, type Prisma } from '../../generated/prisma/client';
import {
  requireTenant,
  requireText,
  requireUuid,
  type TenantContext,
} from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';
import {
  PersistenceConflictError,
  TenantResourceNotFoundError,
} from '../../database/database.errors';
import {
  isSecurityEventId,
  type SecurityEvent,
  type SecurityEventType,
} from './security-event.port';

const securityEventTypes = new Set<SecurityEventType>([
  'risk.state.changed',
  'intervention.required',
  'call.ended',
  'dashboard.risk-event.created',
]);
const securityEventSchemaVersions = new Set(['1.0.0', '1.1.0']);
const dispatchableAlertStatuses = new Set<AlertStatus>([
  AlertStatus.PENDING,
  AlertStatus.DELIVERED,
]);

export type OutboxRecord = Prisma.AlertGetPayload<{
  include: { riskEvent: true; intervention: true };
}>;

export interface ReplayResult {
  status: 'COMPLETE' | 'BOUNDARY_EXCEEDED';
  events: SecurityEvent[];
  oldestAvailableEventId: string | null;
  latestAvailableEventId: string | null;
}

@Injectable()
export class SecurityEventOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimDispatchable(
    limit: number,
    maximumAttempts: number,
    leaseMs: number,
  ): Promise<OutboxRecord[]> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const candidates = await this.prisma.client.alert.findMany({
      where: {
        channel: AlertChannel.SECURITY_WEBSOCKET,
        status: AlertStatus.PENDING,
        attemptCount: { lt: maximumAttempts },
        AND: [
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          {
            OR: [{ dispatchLeaseId: null }, { dispatchLeaseExpiresAt: { lte: now } }],
          },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: { riskEvent: true, intervention: true },
    });
    const claimed: OutboxRecord[] = [];
    for (const candidate of candidates) {
      const dispatchLeaseId = randomUUID();
      const updated = await this.prisma.client.alert.updateMany({
        where: {
          id: candidate.id,
          organizationId: candidate.organizationId,
          status: AlertStatus.PENDING,
          attemptCount: candidate.attemptCount,
          OR: [{ dispatchLeaseId: null }, { dispatchLeaseExpiresAt: { lte: now } }],
        },
        data: {
          attemptCount: { increment: 1 },
          dispatchLeaseId,
          dispatchLeaseExpiresAt: leaseExpiresAt,
          nextAttemptAt: null,
          failureCode: null,
        },
      });
      if (updated.count === 1) {
        claimed.push({
          ...candidate,
          attemptCount: candidate.attemptCount + 1,
          dispatchLeaseId,
          dispatchLeaseExpiresAt: leaseExpiresAt,
        });
      }
    }
    return claimed;
  }

  async markDelivered(record: OutboxRecord): Promise<void> {
    const updated = await this.prisma.client.alert.updateMany({
      where: {
        id: record.id,
        organizationId: record.organizationId,
        status: AlertStatus.PENDING,
        attemptCount: record.attemptCount,
        dispatchLeaseId: record.dispatchLeaseId,
      },
      data: {
        status: AlertStatus.DELIVERED,
        deliveredAt: new Date(),
        dispatchLeaseId: null,
        dispatchLeaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
    if (updated.count !== 1) throw new PersistenceConflictError('Outbox dispatch lease was lost.');
  }

  async markFailed(
    record: OutboxRecord,
    maximumAttempts: number,
    retryBaseMs: number,
  ): Promise<void> {
    const exhausted = record.attemptCount >= maximumAttempts;
    const delay = retryBaseMs * 2 ** Math.max(0, record.attemptCount - 1);
    const updated = await this.prisma.client.alert.updateMany({
      where: {
        id: record.id,
        organizationId: record.organizationId,
        status: AlertStatus.PENDING,
        attemptCount: record.attemptCount,
        dispatchLeaseId: record.dispatchLeaseId,
      },
      data: {
        status: exhausted ? AlertStatus.FAILED : AlertStatus.PENDING,
        failureCode: exhausted
          ? 'SECURITY_EVENT_RETRY_EXHAUSTED'
          : 'SECURITY_EVENT_RETRY_SCHEDULED',
        nextAttemptAt: exhausted ? null : new Date(Date.now() + delay),
        dispatchLeaseId: null,
        dispatchLeaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) throw new PersistenceConflictError('Outbox dispatch lease was lost.');
  }

  async replay(
    context: TenantContext,
    callIds: string[],
    afterEventId: string | undefined,
    maximum: number,
  ): Promise<ReplayResult> {
    const organizationId = requireTenant(context);
    const scopedCallIds = [...new Set(callIds)].map((callId) => requireUuid(callId, 'callId'));
    const records = await this.prisma.client.alert.findMany({
      where: {
        organizationId,
        callId: { in: scopedCallIds },
        channel: AlertChannel.SECURITY_WEBSOCKET,
        status: AlertStatus.DELIVERED,
        externalEventId: { not: null },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: maximum,
      include: { riskEvent: true, intervention: true },
    });
    records.reverse();
    const oldestAvailableEventId = records.at(0)?.externalEventId ?? null;
    const latestAvailableEventId = records.at(-1)?.externalEventId ?? null;
    if (afterEventId === undefined) {
      return {
        status: 'COMPLETE',
        events: [],
        oldestAvailableEventId,
        latestAvailableEventId,
      };
    }
    requireText(afterEventId, 'afterEventId', 68);
    if (!isSecurityEventId(afterEventId)) throw new Error('Security event cursor is invalid.');
    const index = records.findIndex(({ externalEventId }) => externalEventId === afterEventId);
    if (index < 0 && records.length > 0) {
      return {
        status: 'BOUNDARY_EXCEEDED',
        events: [],
        oldestAvailableEventId,
        latestAvailableEventId,
      };
    }
    return {
      status: 'COMPLETE',
      events: records.slice(index + 1).map((record) => this.toSecurityEvent(record)),
      oldestAvailableEventId,
      latestAvailableEventId,
    };
  }

  async acknowledge(
    context: TenantContext,
    membershipId: string,
    callIds: string[],
    eventId: string,
  ): Promise<void> {
    const organizationId = requireTenant(context);
    const scopedCallIds = callIds.map((callId) => requireUuid(callId, 'callId'));
    const record = await this.prisma.client.alert.findUnique({
      where: {
        organizationId_externalEventId: {
          organizationId,
          externalEventId: this.requireEventId(eventId),
        },
      },
    });
    if (
      record === null ||
      (record.status !== AlertStatus.DELIVERED &&
        !(
          record.status === AlertStatus.PENDING &&
          record.dispatchLeaseId !== null &&
          record.dispatchLeaseExpiresAt !== null &&
          record.dispatchLeaseExpiresAt.getTime() > Date.now()
        )) ||
      !scopedCallIds.includes(record.callId)
    ) {
      throw new TenantResourceNotFoundError('Security event');
    }
    await this.prisma.client.alert.update({
      where: { id: record.id },
      data: {
        acknowledgedAt: record.acknowledgedAt ?? new Date(),
        acknowledgedByMembershipId:
          record.acknowledgedByMembershipId ?? requireUuid(membershipId, 'membershipId'),
      },
    });
  }

  toSecurityEvent(record: OutboxRecord): SecurityEvent {
    const externalEventId = record.externalEventId;
    if (!isSecurityEventId(externalEventId)) throw new Error('Security outbox record is invalid.');
    const eventType = record.eventType as SecurityEventType;
    const intervention = record.intervention;
    const invalid =
      record.channel !== AlertChannel.SECURITY_WEBSOCKET ||
      !dispatchableAlertStatuses.has(record.status) ||
      (record.status === AlertStatus.PENDING &&
        (record.dispatchLeaseId === null ||
          record.dispatchLeaseExpiresAt === null ||
          record.dispatchLeaseExpiresAt.getTime() <= Date.now())) ||
      !securityEventTypes.has(eventType) ||
      !securityEventSchemaVersions.has(record.schemaVersion) ||
      record.organizationId !== record.riskEvent.organizationId ||
      record.callId !== record.riskEvent.callId ||
      record.mode !== record.riskEvent.mode ||
      (eventType === 'intervention.required') !== (intervention !== null) ||
      (intervention !== null &&
        (intervention.organizationId !== record.organizationId ||
          intervention.callId !== record.callId ||
          intervention.riskEventId !== record.riskEventId ||
          intervention.mode !== record.mode));
    if (invalid) throw new Error('Security outbox record is invalid.');

    const targetId =
      eventType === 'call.ended' ? record.callId : (intervention?.id ?? record.riskEvent.id);
    return {
      outboxId: record.id,
      eventId: externalEventId,
      eventType,
      schemaVersion: record.schemaVersion,
      organizationId: record.organizationId,
      callId: record.callId,
      targetId,
      occurredAt: record.riskEvent.occurredAt,
      metadata: {
        mode: record.mode,
        state: record.riskEvent.state,
        reasonCode: record.riskEvent.transitionReasonCode,
        policyVersion: record.riskEvent.policyVersion,
        ...(intervention === null ? {} : { interventionType: intervention.type }),
      },
    };
  }

  private requireEventId(value: string): string {
    requireText(value, 'eventId', 68);
    if (!isSecurityEventId(value)) throw new Error('Security event id is invalid.');
    return value;
  }
}
