import { Injectable } from '@nestjs/common';

import { AlertChannel, AlertStatus, type Prisma } from '../../generated/prisma/client';
import {
  requireTenant,
  requireText,
  requireUuid,
  type TenantContext,
} from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';
import { TenantResourceNotFoundError } from '../../database/database.errors';
import type { SecurityEvent } from './security-event.port';

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

  async claimDispatchable(limit: number, maximumAttempts: number): Promise<OutboxRecord[]> {
    const now = new Date();
    const candidates = await this.prisma.client.alert.findMany({
      where: {
        channel: AlertChannel.SECURITY_WEBSOCKET,
        status: AlertStatus.PENDING,
        attemptCount: { lt: maximumAttempts },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: { riskEvent: true, intervention: true },
    });
    const claimed: OutboxRecord[] = [];
    for (const candidate of candidates) {
      const updated = await this.prisma.client.alert.updateMany({
        where: {
          id: candidate.id,
          organizationId: candidate.organizationId,
          status: AlertStatus.PENDING,
          attemptCount: candidate.attemptCount,
        },
        data: { attemptCount: { increment: 1 }, nextAttemptAt: null, failureCode: null },
      });
      if (updated.count === 1) {
        claimed.push({ ...candidate, attemptCount: candidate.attemptCount + 1 });
      }
    }
    return claimed;
  }

  async markDelivered(record: OutboxRecord): Promise<void> {
    await this.prisma.client.alert.updateMany({
      where: {
        id: record.id,
        organizationId: record.organizationId,
        status: AlertStatus.PENDING,
        attemptCount: record.attemptCount,
      },
      data: { status: AlertStatus.DELIVERED, deliveredAt: new Date(), nextAttemptAt: null },
    });
  }

  async markFailed(
    record: OutboxRecord,
    maximumAttempts: number,
    retryBaseMs: number,
  ): Promise<void> {
    const exhausted = record.attemptCount >= maximumAttempts;
    const delay = retryBaseMs * 2 ** Math.max(0, record.attemptCount - 1);
    await this.prisma.client.alert.updateMany({
      where: {
        id: record.id,
        organizationId: record.organizationId,
        status: AlertStatus.PENDING,
        attemptCount: record.attemptCount,
      },
      data: {
        status: exhausted ? AlertStatus.FAILED : AlertStatus.PENDING,
        failureCode: exhausted
          ? 'SECURITY_EVENT_RETRY_EXHAUSTED'
          : 'SECURITY_EVENT_RETRY_SCHEDULED',
        nextAttemptAt: exhausted ? null : new Date(Date.now() + delay),
      },
    });
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
          externalEventId: requireText(eventId, 'eventId', 68),
        },
      },
    });
    if (
      record === null ||
      (record.status !== AlertStatus.DELIVERED &&
        !(record.status === AlertStatus.PENDING && record.attemptCount > 0)) ||
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
    if (record.externalEventId === null) {
      throw new Error('Security outbox record has no external event id.');
    }
    const targetId = record.intervention?.id ?? record.riskEvent.id;
    return {
      outboxId: record.id,
      eventId: record.externalEventId,
      eventType: record.eventType as SecurityEvent['eventType'],
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
        ...(record.intervention === null ? {} : { interventionType: record.intervention.type }),
      },
    };
  }
}
