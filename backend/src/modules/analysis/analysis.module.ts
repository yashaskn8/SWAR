import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { CallsModule } from '../calls/calls.module';
import { AnalysisService } from './analysis.service';

@Module({
  imports: [AuditModule, CallsModule],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
