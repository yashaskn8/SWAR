import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RiskPolicyController } from './risk-policy.controller';
import { RiskPolicyService } from './risk-policy.service';

@Module({
  imports: [AuthModule],
  controllers: [RiskPolicyController],
  providers: [RiskPolicyService],
  exports: [RiskPolicyService],
})
export class GovernanceModule {}
