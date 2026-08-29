import { Module } from '@nestjs/common';

import { DependencyProbeService } from './dependency-probe.service';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';

@Module({
  controllers: [HealthController],
  providers: [DependencyProbeService, ReadinessService],
  exports: [ReadinessService],
})
export class HealthModule {}
