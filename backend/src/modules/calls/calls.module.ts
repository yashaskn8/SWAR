import { Module } from '@nestjs/common';

import { LiveKitClient } from '../../integrations/livekit/livekit.client';
import { LiveKitPort } from '../../integrations/livekit/livekit.port';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CallsService } from './calls.service';
import { CallQueriesService } from './call-queries.service';
import { CallsController } from './calls.controller';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [CallsController],
  providers: [
    LiveKitClient,
    { provide: LiveKitPort, useExisting: LiveKitClient },
    CallsService,
    CallQueriesService,
  ],
  exports: [CallsService, CallQueriesService, LiveKitPort],
})
export class CallsModule {}
