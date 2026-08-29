import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { SecurityEventsService } from './security-events.service';
import { AuthModule } from '../auth/auth.module';
import { CallsModule } from '../calls/calls.module';
import { SecurityEventPort } from './security-event.port';
import { SecurityEventsGateway } from './security-events.gateway';

@Module({
  imports: [AuditModule, AuthModule, CallsModule],
  providers: [
    SecurityEventsGateway,
    { provide: SecurityEventPort, useExisting: SecurityEventsGateway },
    SecurityEventsService,
  ],
  exports: [SecurityEventsService, SecurityEventPort],
})
export class SecurityEventsModule {}
