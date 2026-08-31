import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { SafeLogger } from '../../common/logging/safe-logger.service';
import { OperationalTelemetryService } from '../../common/logging/operational-telemetry.service';
import { ConfigurationService } from '../../config/configuration';
import { SecurityEventPort } from './security-event.port';
import { SecurityEventOutboxRepository } from './security-event-outbox.repository';

@Injectable()
export class SecurityEventOutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private shuttingDown = false;

  constructor(
    private readonly repository: SecurityEventOutboxRepository,
    @Inject(SecurityEventPort) private readonly publisher: SecurityEventPort,
    private readonly configuration: ConfigurationService,
    private readonly logger: SafeLogger,
    private readonly telemetry: OperationalTelemetryService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.flushSafely(),
      this.configuration.values.api.securityOutboxPollIntervalMs,
    );
    this.timer.unref();
    void this.flushSafely();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    const deadline = Date.now() + this.configuration.values.runtime.shutdownTimeoutMs;
    while (this.flushing && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async flush(): Promise<number> {
    if (this.flushing || this.shuttingDown) return 0;
    this.flushing = true;
    let delivered = 0;
    try {
      const api = this.configuration.values.api;
      const records = await this.repository.claimDispatchable(
        api.securityOutboxBatchSize,
        api.securityOutboxMaximumAttempts,
        api.securityOutboxLeaseMs,
      );
      this.telemetry.gauge('swar_backend_security_outbox_claimed_depth', records.length);
      for (const record of records) {
        try {
          await this.publisher.publish(this.repository.toSecurityEvent(record));
          await this.repository.markDelivered(record);
          delivered += 1;
          this.telemetry.increment('swar_backend_security_outbox_delivery_total', {
            mode: record.mode,
            status: 'DELIVERED',
          });
          this.logger.event('log', 'security.outbox.delivered', {
            organizationId: record.organizationId,
            callId: record.callId,
            outboxId: record.id,
            mode: record.mode,
            attemptCount: record.attemptCount,
            deliveryStatus: 'DELIVERED',
          });
        } catch {
          await this.repository.markFailed(
            record,
            api.securityOutboxMaximumAttempts,
            api.securityOutboxRetryBaseMs,
          );
          this.telemetry.increment('swar_backend_security_outbox_delivery_total', {
            mode: record.mode,
            status:
              record.attemptCount >= api.securityOutboxMaximumAttempts
                ? 'RETRY_EXHAUSTED'
                : 'RETRY_SCHEDULED',
          });
          this.logger.event(
            record.attemptCount >= api.securityOutboxMaximumAttempts ? 'error' : 'warn',
            'security.outbox.delivery-failed',
            {
              organizationId: record.organizationId,
              callId: record.callId,
              outboxId: record.id,
              mode: record.mode,
              attemptCount: record.attemptCount,
              deliveryStatus:
                record.attemptCount >= api.securityOutboxMaximumAttempts
                  ? 'RETRY_EXHAUSTED'
                  : 'RETRY_SCHEDULED',
            },
          );
        }
      }
      return delivered;
    } finally {
      this.flushing = false;
    }
  }

  private async flushSafely(): Promise<void> {
    try {
      await this.flush();
    } catch {
      this.logger.event('error', 'security.outbox.unavailable', {
        dependency: 'postgresql',
        deliveryStatus: 'OUTBOX_DEGRADED',
      });
    }
  }
}
