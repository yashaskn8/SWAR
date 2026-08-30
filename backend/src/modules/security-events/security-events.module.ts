import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { SecurityEventsService } from './security-events.service';
import { AuthModule } from '../auth/auth.module';
import { CallsModule } from '../calls/calls.module';
import { SecurityEventPort } from './security-event.port';
import { SecurityEventsGateway } from './security-events.gateway';
import { SecurityEventOutboxRepository } from './security-event-outbox.repository';
import { SecurityEventOutboxService } from './security-event-outbox.service';

@Module({
  imports: [AuditModule, AuthModule, CallsModule],
  providers: [
    SecurityEventsGateway,
    SecurityEventOutboxRepository,
    { provide: SecurityEventPort, useExisting: SecurityEventsGateway },
    SecurityEventsService,
    SecurityEventOutboxService,
  ],
  exports: [SecurityEventsService, SecurityEventPort, SecurityEventOutboxService],
})
export class SecurityEventsModule {}
