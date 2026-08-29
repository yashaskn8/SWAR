import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TrustedSpeakersService } from './trusted-speakers.service';
import { TrustedSpeakersController } from './trusted-speakers.controller';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [TrustedSpeakersController],
  providers: [TrustedSpeakersService],
  exports: [TrustedSpeakersService],
})
export class TrustedSpeakersModule {}
