import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { AuditOutcome } from '../../generated/prisma/client';

import { AuditService } from '../audit/audit.service';
import { DomainProviderError } from '../domain/domain.errors';
import {
  SecurityEventPort,
  type SecurityEvent,
  type SecurityEventType,
} from './security-event.port';

function eventId(input: {
  organizationId: string;
  eventType: SecurityEventType;
  targetId: string;
  idempotencyKey: string;
}): string {
  return `evt_${createHash('sha256')
    .update(`${input.organizationId}:${input.eventType}:${input.targetId}:${input.idempotencyKey}`)
    .digest('hex')}`;
}

@Injectable()
export class SecurityEventsService {
  constructor(
    private readonly audit: AuditService,
    @Optional() @Inject(SecurityEventPort) private readonly publisher?: SecurityEventPort,
  ) {}

  async createAndPublish(input: {
    organizationId: string;
    callId: string;
    targetId: string;
    eventType: SecurityEventType;
    schemaVersion: string;
    idempotencyKey: string;
    correlationId: string;
    occurredAt: Date;
    metadata?: SecurityEvent['metadata'];
  }): Promise<SecurityEvent> {
    const event: SecurityEvent = {
      eventId: eventId(input),
      eventType: input.eventType,
      schemaVersion: input.schemaVersion,
      organizationId: input.organizationId,
      callId: input.callId,
      targetId: input.targetId,
      occurredAt: input.occurredAt,
      metadata: input.metadata ?? {},
    };
    try {
      if (this.publisher === undefined) throw new Error('Security event publisher unavailable');
      await this.publisher.publish(event);
    } catch {
      await this.audit.record({
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:publish-failed`,
        action: 'security-event.publish.failed',
        targetType: 'SecurityEvent',
        targetId: input.targetId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'SECURITY_EVENT_PROVIDER_FAILED',
        operation: input.eventType,
      });
      throw new DomainProviderError('SECURITY_EVENT', 'publish', 'RETRY_REQUIRED');
    }
    await this.audit.record({
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      idempotencyKey: `${input.idempotencyKey}:published`,
      action: 'security-event.published',
      targetType: 'SecurityEvent',
      targetId: input.targetId,
      operation: input.eventType,
    });
    return event;
  }
}
