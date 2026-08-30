import { describe, expect, it, vi } from 'vitest';

import { OperationalTelemetryService } from '../../../src/common/logging/operational-telemetry.service';
import type { SafeLogger } from '../../../src/common/logging/safe-logger.service';
import { ConfigurationService } from '../../../src/config/configuration';
import type { PrismaService } from '../../../src/database/prisma.service';
import {
  AlertStatus,
  InterventionStatus,
  InterventionType,
  SecurityControlMode,
} from '../../../src/generated/prisma/client';
import { EngineeringInterventionExecutorService } from '../../../src/modules/interventions/engineering-intervention-executor.service';
import type { InterventionPort } from '../../../src/modules/interventions/intervention.port';
import { SecurityEventOutboxRepository } from '../../../src/modules/security-events/security-event-outbox.repository';
import { SecurityEventOutboxService } from '../../../src/modules/security-events/security-event-outbox.service';
import type { SecurityEventPort } from '../../../src/modules/security-events/security-event.port';
import { validTestEnvironment } from '../../test-environment';

const ids = {
  organizationId: '018f0000-0000-7000-8000-000000000001',
  callId: '018f0000-0000-7000-8000-000000000002',
  interventionId: '018f0000-0000-7000-8000-000000000003',
  outboxId: '018f0000-0000-7000-8000-000000000004',
};

describe('headless outbox and demo intervention reliability', () => {
  const logEvent = vi.fn();
  const logger = { event: logEvent } as unknown as SafeLogger;

  it('fences a dispatch claim with an expiring lease and requires it for completion', async () => {
    const candidate = {
      id: ids.outboxId,
      organizationId: ids.organizationId,
      status: AlertStatus.PENDING,
      attemptCount: 0,
      dispatchLeaseId: null,
      dispatchLeaseExpiresAt: null,
    } as never;
    const findMany = vi.fn().mockResolvedValue([candidate]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new SecurityEventOutboxRepository({
      client: { alert: { findMany, updateMany } },
    } as unknown as PrismaService);
    const claimed = await repository.claimDispatchable(1, 3, 5_000);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.dispatchLeaseId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(claimed[0]?.dispatchLeaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    await repository.markDelivered(claimed[0] as never);
    const completion = updateMany.mock.calls.at(-1)?.[0] as unknown as {
      where: { dispatchLeaseId: string | null };
      data: {
        status: AlertStatus;
        dispatchLeaseId: string | null;
        dispatchLeaseExpiresAt: Date | null;
      };
    };
    expect(completion.where.dispatchLeaseId).toBe(claimed[0]?.dispatchLeaseId);
    expect(completion.data).toMatchObject({
      status: AlertStatus.DELIVERED,
      dispatchLeaseId: null,
      dispatchLeaseExpiresAt: null,
    });
  });

  it('rejects corrupted outbox event types and cross-mode records before publication', () => {
    const repository = new SecurityEventOutboxRepository({} as PrismaService);
    const record = {
      id: ids.outboxId,
      organizationId: ids.organizationId,
      callId: ids.callId,
      riskEventId: '018f0000-0000-7000-8000-000000000005',
      externalEventId: `evt_${'a'.repeat(64)}`,
      eventType: 'risk.state.changed',
      schemaVersion: '1.1.0',
      mode: SecurityControlMode.DEMO,
      riskEvent: {
        id: '018f0000-0000-7000-8000-000000000005',
        organizationId: ids.organizationId,
        callId: ids.callId,
        mode: SecurityControlMode.DEMO,
        state: 'CRITICAL',
        transitionReasonCode: 'ENGINEERING_FIXTURE',
        policyVersion: 'engineering-v1',
        occurredAt: new Date('2030-01-01T00:00:00Z'),
      },
      intervention: null,
    };
    expect(() =>
      repository.toSecurityEvent({ ...record, eventType: 'arbitrary.event' } as never),
    ).toThrow('Security outbox record is invalid.');
    expect(() =>
      repository.toSecurityEvent({ ...record, mode: SecurityControlMode.SHADOW } as never),
    ).toThrow('Security outbox record is invalid.');
  });

  it('delivers a claimed outbox record and records success telemetry', async () => {
    const record = {
      id: ids.outboxId,
      organizationId: ids.organizationId,
      callId: ids.callId,
      mode: SecurityControlMode.DEMO,
      attemptCount: 1,
    } as never;
    const event = {
      eventId: `evt_${'a'.repeat(64)}`,
      eventType: 'risk.state.changed' as const,
      schemaVersion: '1.1.0',
      organizationId: ids.organizationId,
      callId: ids.callId,
      targetId: ids.outboxId,
      occurredAt: new Date(),
      metadata: { mode: 'DEMO' as const },
    };
    const markDelivered = vi.fn().mockResolvedValue(undefined);
    const markFailed = vi.fn();
    const repository = {
      claimDispatchable: vi.fn().mockResolvedValue([record]),
      toSecurityEvent: vi.fn().mockReturnValue(event),
      markDelivered,
      markFailed,
    } as unknown as SecurityEventOutboxRepository;
    const publish = vi.fn().mockResolvedValue(undefined);
    const publisher: SecurityEventPort = { publish };
    const telemetry = new OperationalTelemetryService();
    const service = new SecurityEventOutboxService(
      repository,
      publisher,
      new ConfigurationService(validTestEnvironment()),
      logger,
      telemetry,
    );
    await expect(service.flush()).resolves.toBe(1);
    expect(publish).toHaveBeenCalledWith(event);
    expect(markDelivered).toHaveBeenCalledWith(record);
    expect(markFailed).not.toHaveBeenCalled();
    expect(telemetry.renderPrometheus()).toContain(
      'swar_backend_security_outbox_delivery_total{mode="DEMO",status="DELIVERED"} 1',
    );
  });

  it('retains callback failures for bounded retry without exposing exception content', async () => {
    const record = {
      id: ids.outboxId,
      organizationId: ids.organizationId,
      callId: ids.callId,
      mode: SecurityControlMode.SHADOW,
      attemptCount: 3,
    } as never;
    const markDelivered = vi.fn();
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const repository = {
      claimDispatchable: vi.fn().mockResolvedValue([record]),
      toSecurityEvent: vi.fn().mockReturnValue({ metadata: { mode: 'SHADOW' } }),
      markDelivered,
      markFailed,
    } as unknown as SecurityEventOutboxRepository;
    const publish = vi.fn().mockRejectedValue(new Error('token=must-not-be-logged'));
    const publisher: SecurityEventPort = { publish };
    const telemetry = new OperationalTelemetryService();
    const service = new SecurityEventOutboxService(
      repository,
      publisher,
      new ConfigurationService(validTestEnvironment()),
      logger,
      telemetry,
    );
    await expect(service.flush()).resolves.toBe(0);
    expect(markFailed).toHaveBeenCalledWith(record, 3, 25);
    expect(markDelivered).not.toHaveBeenCalled();
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('must-not-be-logged');
    expect(telemetry.renderPrometheus()).toContain('status="RETRY_EXHAUSTED"');
  });

  it('executes only a tagged DEMO protected-action hold and advances it idempotently', async () => {
    const candidate = {
      id: ids.interventionId,
      organizationId: ids.organizationId,
      callId: ids.callId,
      mode: SecurityControlMode.DEMO,
      type: InterventionType.HOLD_PROTECTED_ACTION,
      status: InterventionStatus.REQUIRED,
      protectedActionReference: 'DEMO-ACTION-1',
      executionAttemptCount: 0,
    };
    const findMany = vi.fn().mockResolvedValue([candidate]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hold = vi.fn().mockResolvedValue({
      adapterKind: 'SWAR_DEMO_TRANSACTION_HOLD' as const,
      protectedActionReference: candidate.protectedActionReference,
      interventionId: candidate.id,
      status: 'HELD' as const,
    });
    const provider: InterventionPort = { hold, release: vi.fn() };
    const telemetry = new OperationalTelemetryService();
    const service = new EngineeringInterventionExecutorService(
      { client: { intervention: { findMany, updateMany } } } as unknown as PrismaService,
      provider,
      new ConfigurationService(validTestEnvironment()),
      logger,
      telemetry,
    );
    await expect(service.executePending()).resolves.toBe(1);
    expect(JSON.stringify(findMany.mock.calls)).toContain(`"mode":"${SecurityControlMode.DEMO}"`);
    expect(hold).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ids.organizationId,
        interventionId: ids.interventionId,
        idempotencyKey: `demo-auto-hold:${ids.interventionId}`,
      }),
    );
    expect(JSON.stringify(updateMany.mock.calls.at(-1))).toContain(
      `"status":"${InterventionStatus.IN_PROGRESS}"`,
    );
  });
});
