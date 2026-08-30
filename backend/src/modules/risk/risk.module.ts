import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { RiskActivationGateService } from './risk-activation-gate.service';
import { RiskDecisionService } from './risk-decision.service';
import { HeadlessRiskPipelineService } from './headless-risk-pipeline.service';

@Module({
  imports: [AuditModule],
  providers: [RiskActivationGateService, RiskDecisionService, HeadlessRiskPipelineService],
  exports: [RiskActivationGateService, RiskDecisionService, HeadlessRiskPipelineService],
})
export class RiskModule {}
