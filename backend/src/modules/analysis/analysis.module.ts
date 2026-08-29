import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AnalysisService } from './analysis.service';

@Module({ imports: [AuditModule], providers: [AnalysisService], exports: [AnalysisService] })
export class AnalysisModule {}
