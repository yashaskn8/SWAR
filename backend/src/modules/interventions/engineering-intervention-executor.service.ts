import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { SafeLogger } from '../../common/logging/safe-logger.service';
import { OperationalTelemetryService } from '../../common/logging/operational-telemetry.service';
import { ConfigurationService } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import {
  InterventionStatus,
  InterventionType,
  SecurityControlMode,
} from '../../generated/prisma/client';
import { InterventionPort } from './intervention.port';

@Injectable()
export class EngineeringInterventionExecutorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(InterventionPort) private readonly provider: InterventionPort,
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
    if (this.timer !== undefined) clearInterval(this.timer);
    await this.runSafely();
  }

  async executePending(): Promise<number> {
    if (this.running || this.configuration.values.runtime.environment === 'production') return 0;
    this.running = true;
    let completed = 0;
    try {
      const api = this.configuration.values.api;
      const now = new Date();
      const candidates = await this.prisma.client.intervention.findMany({
        where: {
          mode: SecurityControlMode.DEMO,
          type: InterventionType.HOLD_PROTECTED_ACTION,
          status: InterventionStatus.REQUIRED,
          protectedActionReference: { not: null },
          executionAttemptCount: { lt: api.securityOutboxMaximumAttempts },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { requiredAt: 'asc' }, { id: 'asc' }],
        take: api.securityOutboxBatchSize,
      });
      for (const candidate of candidates) {
        const attempt = candidate.executionAttemptCount + 1;
        const claimed = await this.prisma.client.intervention.updateMany({
          where: {
            id: candidate.id,
            organizationId: candidate.organizationId,
            mode: SecurityControlMode.DEMO,
            status: InterventionStatus.REQUIRED,
            executionAttemptCount: candidate.executionAttemptCount,
          },
          data: {
            executionAttemptCount: { increment: 1 },
            nextAttemptAt: null,
            failureCode: null,
          },
        });
        if (claimed.count !== 1 || candidate.protectedActionReference === null) continue;
        try {
          await this.provider.hold({
            organizationId: candidate.organizationId,
            interventionId: candidate.id,
            protectedActionReference: candidate.protectedActionReference,
            idempotencyKey: `demo-auto-hold:${candidate.id}`,
          });
          await this.prisma.client.intervention.updateMany({
            where: {
              id: candidate.id,
              organizationId: candidate.organizationId,
              mode: SecurityControlMode.DEMO,
              status: InterventionStatus.REQUIRED,
              executionAttemptCount: attempt,
            },
            data: { status: InterventionStatus.IN_PROGRESS, nextAttemptAt: null },
          });
          completed += 1;
          this.telemetry.increment('swar_backend_intervention_outcomes_total', {
            mode: candidate.mode,
            outcome: 'DEMO_HOLD_APPLIED',
          });
          this.logger.event('log', 'intervention.demo-hold.applied', {
            organizationId: candidate.organizationId,
            callId: candidate.callId,
            interventionId: candidate.id,
            mode: candidate.mode,
            attemptCount: attempt,
            outcome: 'DEMO_HOLD_APPLIED',
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
            },
            data: {
              status: exhausted ? InterventionStatus.FAILED : InterventionStatus.REQUIRED,
              failureCode: exhausted ? 'DEMO_HOLD_RETRY_EXHAUSTED' : 'DEMO_HOLD_RETRY_SCHEDULED',
              nextAttemptAt: exhausted ? null : new Date(Date.now() + delay),
            },
          });
          this.telemetry.increment('swar_backend_intervention_outcomes_total', {
            mode: candidate.mode,
            outcome: exhausted ? 'RETRY_EXHAUSTED' : 'RETRY_SCHEDULED',
          });
          this.logger.event(exhausted ? 'error' : 'warn', 'intervention.demo-hold.failed', {
            organizationId: candidate.organizationId,
            callId: candidate.callId,
            interventionId: candidate.id,
            mode: candidate.mode,
            attemptCount: attempt,
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
