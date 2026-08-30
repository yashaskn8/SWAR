import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RiskModule } from '../risk/risk.module';
import { EvidenceIngestionService } from './evidence-ingestion.service';
import { InternalEvidenceController } from './internal-evidence.controller';
import { SecurityEventsModule } from '../security-events/security-events.module';
import { InterventionsModule } from '../interventions/interventions.module';

@Module({
  imports: [AuthModule, RiskModule, SecurityEventsModule, InterventionsModule],
  controllers: [InternalEvidenceController],
  providers: [EvidenceIngestionService],
  exports: [EvidenceIngestionService],
})
export class EvidenceModule {}
