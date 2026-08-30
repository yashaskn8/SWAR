import { describe, expect, it, vi } from 'vitest';

import { OperationalTelemetryService } from '../../../src/common/logging/operational-telemetry.service';
import type { SafeLogger } from '../../../src/common/logging/safe-logger.service';
import { ConfigurationService } from '../../../src/config/configuration';
import type { PrismaService } from '../../../src/database/prisma.service';
import {
  InterventionStatus,
  InterventionType,
  SecurityControlMode,
} from '../../../src/generated/prisma/client';
import { EngineeringInterventionExecutorService } from '../../../src/modules/interventions/engineering-intervention-executor.service';
import type { InterventionPort } from '../../../src/modules/interventions/intervention.port';
import type { SecurityEventOutboxRepository } from '../../../src/modules/security-events/security-event-outbox.repository';
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
