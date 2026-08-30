import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { DependencyProbeService } from './dependency-probe.service';
import { OperationalTelemetryService } from '../../common/logging/operational-telemetry.service';

export type ReadinessStatus = 'ready' | 'not_ready';

export interface ReadinessResponse {
  service: 'swar-backend';
  status: ReadinessStatus;
  checks: {
    database: ReadinessStatus;
    ml: ReadinessStatus;
    livekit: ReadinessStatus;
  };
}

@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dependencies: DependencyProbeService,
    private readonly telemetry: OperationalTelemetryService,
  ) {}

  async check(): Promise<ReadinessResponse> {
    const [database, ml, livekit] = await Promise.all([
      this.databaseReady(),
      this.dependencies.probeMl(),
      this.dependencies.probeLiveKit(),
    ]);
    const status = database && ml && livekit ? 'ready' : 'not_ready';
    for (const [dependency, ready] of Object.entries({ database, ml, livekit })) {
      this.telemetry.gauge('swar_backend_dependency_ready', ready ? 1 : 0, { dependency });
      if (!ready) {
        this.telemetry.increment('swar_backend_dependency_not_ready_total', { dependency });
      }
    }
    return {
      service: 'swar-backend',
      status,
      checks: {
        database: database ? 'ready' : 'not_ready',
        ml: ml ? 'ready' : 'not_ready',
        livekit: livekit ? 'ready' : 'not_ready',
      },
    };
  }

  private async databaseReady(): Promise<boolean> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
