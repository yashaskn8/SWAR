import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DemoTransactionHoldAdapter } from './demo-transaction-hold.adapter';
import { InterventionPort } from './intervention.port';
import { InterventionsService } from './interventions.service';
import { InterventionsController } from './interventions.controller';
import { StepUpService } from './step-up.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [InterventionsController],
  providers: [
    DemoTransactionHoldAdapter,
    { provide: InterventionPort, useExisting: DemoTransactionHoldAdapter },
    InterventionsService,
    StepUpService,
  ],
  exports: [InterventionsService, StepUpService, InterventionPort],
})
export class InterventionsModule {}
