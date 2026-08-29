import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { VoiceEnrollmentService } from './voice-enrollment.service';
import { VoiceprintCipherService } from './voiceprint-cipher.service';
import { VoiceEnrollmentController } from './voice-enrollment.controller';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [VoiceEnrollmentController],
  providers: [VoiceprintCipherService, VoiceEnrollmentService],
  exports: [VoiceprintCipherService, VoiceEnrollmentService],
})
export class VoiceEnrollmentModule {}
