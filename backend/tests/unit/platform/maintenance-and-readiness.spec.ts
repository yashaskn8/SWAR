import { describe, expect, it, vi } from 'vitest';

import type { SafeLogger } from '../../../src/common/logging/safe-logger.service';
import { OperationalTelemetryService } from '../../../src/common/logging/operational-telemetry.service';
import { ConfigurationService } from '../../../src/config/configuration';
import type { PrismaService } from '../../../src/database/prisma.service';
import type { DependencyProbeService } from '../../../src/modules/health/dependency-probe.service';
import { ReadinessService } from '../../../src/modules/health/readiness.service';
import { BackendMaintenanceService } from '../../../src/modules/maintenance/backend-maintenance.service';
import { validTestEnvironment } from '../../test-environment';

describe('backend maintenance and production readiness', () => {
  it('expires sessions, challenges, and only non-active interventions in one bounded batch', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 4 });
    const client = {
      analysisSession: { updateMany },
      verificationChallenge: { updateMany },
      intervention: { updateMany },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const telemetry = new OperationalTelemetryService();
    const maintenance = new BackendMaintenanceService(
      { client } as unknown as PrismaService,
      new ConfigurationService(validTestEnvironment()),
      telemetry,
      { event: vi.fn() } as unknown as SafeLogger,
    );
    await expect(maintenance.expireStaleRecords()).resolves.toBe(9);
    const interventionFilter = updateMany.mock.calls[2]?.[0] as {
      where: { status: { in: string[] } };
    };
    expect(interventionFilter.where.status.in).toEqual(['REQUIRED', 'ACKNOWLEDGED']);
    expect(interventionFilter.where.status.in).not.toContain('IN_PROGRESS');
    expect(telemetry.renderPrometheus()).toContain('swar_backend_maintenance_expired_records 9');
  });

  it('reports production activation not ready while Phase O/P/Q promotion is blocked', async () => {
    const telemetry = new OperationalTelemetryService();
    const readiness = new ReadinessService(
      {
        client: { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) },
      } as unknown as PrismaService,
      {
        probeMl: vi.fn().mockResolvedValue(true),
        probeLiveKit: vi.fn().mockResolvedValue(true),
      } as unknown as DependencyProbeService,
      telemetry,
      new ConfigurationService(validTestEnvironment()),
    );
    await expect(readiness.check()).resolves.toMatchObject({
      status: 'not_ready',
      checks: {
        database: 'ready',
        ml: 'ready',
        livekit: 'ready',
        productionActivation: 'not_ready',
      },
    });
    expect(telemetry.renderPrometheus()).toContain('dependency="productionActivation"');
  });
});
