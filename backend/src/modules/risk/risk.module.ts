import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { RiskActivationGateService } from './risk-activation-gate.service';
import { RiskDecisionService } from './risk-decision.service';

@Module({
  imports: [AuditModule],
  providers: [RiskActivationGateService, RiskDecisionService],
  exports: [RiskActivationGateService, RiskDecisionService],
})
export class RiskModule {}
