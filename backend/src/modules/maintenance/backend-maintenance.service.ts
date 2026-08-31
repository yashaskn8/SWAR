import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { SafeLogger } from '../../common/logging/safe-logger.service';
import { OperationalTelemetryService } from '../../common/logging/operational-telemetry.service';
import { ConfigurationService } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class BackendMaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running = false;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: ConfigurationService,
    private readonly telemetry: OperationalTelemetryService,
    private readonly logger: SafeLogger,
  ) {}

  onApplicationBootstrap(): void {
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

  async expireStaleRecords(): Promise<number> {
    if (this.running || this.shuttingDown) return 0;
    this.running = true;
    try {
      const now = new Date();
      const [sessions, challenges, interventions] = await this.prisma.client.$transaction([
        this.prisma.client.analysisSession.updateMany({
          where: {
            expiresAt: { lte: now },
            status: { in: ['AUTHORIZED', 'STARTING', 'ACTIVE', 'DEGRADED'] },
          },
          data: { status: 'EXPIRED', stoppedAt: now, failureCode: 'SESSION_TTL_EXPIRED' },
        }),
        this.prisma.client.verificationChallenge.updateMany({
          where: { expiresAt: { lte: now }, status: 'PENDING' },
          data: { status: 'EXPIRED', completedAt: now, resultCode: 'CHALLENGE_TTL_EXPIRED' },
        }),
        this.prisma.client.intervention.updateMany({
          where: {
            expiresAt: { lte: now },
            status: { in: ['REQUIRED', 'ACKNOWLEDGED'] },
          },
          data: {
            status: 'EXPIRED',
            resolvedAt: now,
            executionLeaseId: null,
            executionLeaseExpiresAt: null,
            nextAttemptAt: null,
            failureCode: 'INTERVENTION_TTL_EXPIRED',
          },
        }),
      ]);
      const expired = sessions.count + challenges.count + interventions.count;
      this.telemetry.gauge('swar_backend_maintenance_expired_records', expired);
      return expired;
    } finally {
      this.running = false;
    }
  }

  private async runSafely(): Promise<void> {
    try {
      await this.expireStaleRecords();
    } catch {
      this.telemetry.increment('swar_backend_maintenance_failures_total', {
        operation: 'expiry',
      });
      this.logger.event('error', 'backend.maintenance.failed', {
        dependency: 'postgresql',
        outcome: 'MAINTENANCE_DEGRADED',
      });
    }
  }
}
