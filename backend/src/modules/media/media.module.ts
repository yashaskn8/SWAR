import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { AuditModule } from '../audit/audit.module';
import { TrackBindingService } from './track-binding.service';
import { CallsModule } from '../calls/calls.module';
import { LiveKitWebhookController } from './livekit-webhook.controller';

@Module({
  imports: [AnalysisModule, AuditModule, CallsModule],
  controllers: [LiveKitWebhookController],
  providers: [TrackBindingService],
  exports: [TrackBindingService],
})
export class MediaModule {}
