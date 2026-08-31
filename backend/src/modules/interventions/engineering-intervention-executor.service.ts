import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { SafeLogger } from '../../common/logging/safe-logger.service';
import { OperationalTelemetryService } from '../../common/logging/operational-telemetry.service';
import { ConfigurationService } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import {
  AuditOutcome,
  InterventionStatus,
  InterventionType,
  SecurityControlMode,
} from '../../generated/prisma/client';
import { InterventionPort } from './intervention.port';
import { EngineeringActionPort } from './engineering-action.port';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class EngineeringInterventionExecutorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(InterventionPort) private readonly provider: InterventionPort,
    @Inject(EngineeringActionPort) private readonly demoActions: EngineeringActionPort,
    private readonly audit: AuditService,
    private readonly configuration: ConfigurationService,
    private readonly logger: SafeLogger,
    private readonly telemetry: OperationalTelemetryService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.configuration.values.runtime.environment === 'production') return;
    const interval = this.configuration.values.api.securityOutboxPollIntervalMs;
    this.timer = setInterval(() => void this.runSafely(), interval);
    this.timer.unref();
    void this.runSafely();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    const deadline = Date.now() + this.configuration.values.runtime.shutdownTimeoutMs;
    while (this.running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async executePending(): Promise<number> {
    if (
      this.running ||
      this.shuttingDown ||
      this.configuration.values.runtime.environment === 'production'
    )
      return 0;
    this.running = true;
    let completed = 0;
    try {
      const api = this.configuration.values.api;
      const now = new Date();
      const candidates = await this.prisma.client.intervention.findMany({
        where: {
          mode: SecurityControlMode.DEMO,
          status: InterventionStatus.REQUIRED,
          executionAttemptCount: { lt: api.securityOutboxMaximumAttempts },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          AND: [
            {
              OR: [
                { executionLeaseId: null, executionLeaseExpiresAt: null },
                { executionLeaseExpiresAt: { lte: now } },
              ],
            },
          ],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { requiredAt: 'asc' }, { id: 'asc' }],
        take: api.securityOutboxBatchSize,
      });
      for (const candidate of candidates) {
        const attempt = candidate.executionAttemptCount + 1;
        const leaseId = randomUUID();
        const leaseExpiresAt = new Date(Date.now() + api.securityOutboxLeaseMs);
        const claimed = await this.prisma.client.intervention.updateMany({
          where: {
            id: candidate.id,
            organizationId: candidate.organizationId,
            mode: SecurityControlMode.DEMO,
            status: InterventionStatus.REQUIRED,
            executionAttemptCount: candidate.executionAttemptCount,
            OR: [
              { executionLeaseId: null, executionLeaseExpiresAt: null },
              { executionLeaseExpiresAt: { lte: now } },
            ],
          },
          data: {
            executionAttemptCount: { increment: 1 },
            nextAttemptAt: null,
            executionLeaseId: leaseId,
            executionLeaseExpiresAt: leaseExpiresAt,
            failureCode: null,
          },
        });
        if (claimed.count !== 1) continue;
        try {
          if (candidate.type === InterventionType.HOLD_PROTECTED_ACTION) {
            if (candidate.protectedActionReference === null) {
              throw new Error('DEMO_HOLD_REFERENCE_MISSING');
            }
            await this.provider.hold({
              organizationId: candidate.organizationId,
              interventionId: candidate.id,
              protectedActionReference: candidate.protectedActionReference,
              idempotencyKey: `demo-dispatch:${candidate.id}`,
            });
          } else {
            await this.demoActions.dispatch({
              organizationId: candidate.organizationId,
              callId: candidate.callId,
              interventionId: candidate.id,
              action: candidate.type,
              idempotencyKey: `demo-dispatch:${candidate.id}`,
            });
          }
          await this.prisma.client.intervention.updateMany({
            where: {
              id: candidate.id,
              organizationId: candidate.organizationId,
              mode: SecurityControlMode.DEMO,
              status: InterventionStatus.REQUIRED,
              executionAttemptCount: attempt,
              executionLeaseId: leaseId,
            },
            data: {
              status: InterventionStatus.IN_PROGRESS,
              nextAttemptAt: null,
              executionLeaseId: null,
              executionLeaseExpiresAt: null,
            },
          });
          await this.audit.record({
            organizationId: candidate.organizationId,
            correlationId: leaseId,
            idempotencyKey: `demo-dispatch:${candidate.id}:succeeded`,
            action: 'intervention.demo-action.dispatched',
            targetType: 'Intervention',
            targetId: candidate.id,
            operation: 'demo-intervention-dispatch',
          });
          completed += 1;
          this.telemetry.increment('swar_backend_intervention_outcomes_total', {
            mode: candidate.mode,
            outcome: 'DEMO_ACTION_DISPATCHED',
          });
          this.logger.event('log', 'intervention.demo-action.dispatched', {
            organizationId: candidate.organizationId,
            callId: candidate.callId,
            interventionId: candidate.id,
            mode: candidate.mode,
            attemptCount: attempt,
            interventionType: candidate.type,
            outcome: 'DEMO_ACTION_DISPATCHED',
          });
        } catch {
          const exhausted = attempt >= api.securityOutboxMaximumAttempts;
          const delay = api.securityOutboxRetryBaseMs * 2 ** Math.max(0, attempt - 1);
          await this.prisma.client.intervention.updateMany({
            where: {
              id: candidate.id,
              organizationId: candidate.organizationId,
              mode: SecurityControlMode.DEMO,
              status: InterventionStatus.REQUIRED,
              executionAttemptCount: attempt,
              executionLeaseId: leaseId,
            },
            data: {
              status: exhausted ? InterventionStatus.FAILED : InterventionStatus.REQUIRED,
              failureCode: exhausted
                ? 'DEMO_ACTION_RETRY_EXHAUSTED'
                : 'DEMO_ACTION_RETRY_SCHEDULED',
              nextAttemptAt: exhausted ? null : new Date(Date.now() + delay),
              executionLeaseId: null,
              executionLeaseExpiresAt: null,
              deadLetteredAt: exhausted ? new Date() : null,
            },
          });
          await this.audit.record({
            organizationId: candidate.organizationId,
            correlationId: leaseId,
            idempotencyKey: `demo-dispatch:${candidate.id}:attempt:${attempt}:failed`,
            action: 'intervention.demo-action.failed',
            targetType: 'Intervention',
            targetId: candidate.id,
            outcome: AuditOutcome.FAILED,
            reasonCode: exhausted ? 'DEMO_ACTION_RETRY_EXHAUSTED' : 'DEMO_ACTION_RETRY_SCHEDULED',
            operation: 'demo-intervention-dispatch',
          });
          this.telemetry.increment('swar_backend_intervention_outcomes_total', {
            mode: candidate.mode,
            outcome: exhausted ? 'RETRY_EXHAUSTED' : 'RETRY_SCHEDULED',
          });
          this.logger.event(exhausted ? 'error' : 'warn', 'intervention.demo-action.failed', {
            organizationId: candidate.organizationId,
            callId: candidate.callId,
            interventionId: candidate.id,
            mode: candidate.mode,
            attemptCount: attempt,
            interventionType: candidate.type,
            outcome: exhausted ? 'RETRY_EXHAUSTED' : 'RETRY_SCHEDULED',
          });
        }
      }
      return completed;
    } finally {
      this.running = false;
    }
  }

  private async runSafely(): Promise<void> {
    try {
      await this.executePending();
    } catch {
      this.logger.event('error', 'intervention.demo-executor.unavailable', {
        dependency: 'postgresql',
        outcome: 'EXECUTOR_DEGRADED',
      });
    }
  }
}
