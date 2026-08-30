import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RiskModule } from '../risk/risk.module';
import { EvidenceIngestionService } from './evidence-ingestion.service';
import { InternalEvidenceController } from './internal-evidence.controller';

@Module({
  imports: [AuthModule, RiskModule],
  controllers: [InternalEvidenceController],
  providers: [EvidenceIngestionService],
  exports: [EvidenceIngestionService],
})
export class EvidenceModule {}
