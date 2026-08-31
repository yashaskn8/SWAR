import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SecurityOperationsController } from './security-operations.controller';
import { SecurityOperationsRepository } from './security-operations.repository';
import { SecurityOperationsService } from './security-operations.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [SecurityOperationsController],
  providers: [SecurityOperationsRepository, SecurityOperationsService],
})
export class SecurityOperationsModule {}
