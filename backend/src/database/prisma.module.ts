import { Global, Module } from '@nestjs/common';

import { AuditRepository } from '../modules/audit/audit.repository';
import { CallRepository } from '../modules/calls/call.repository';
import { EnrollmentRepository } from '../modules/enrollment/enrollment.repository';
import { EvidenceRepository } from '../modules/evidence/evidence.repository';
import { GovernanceRepository } from '../modules/governance/governance.repository';
import { IdentityRepository } from '../modules/identity/identity.repository';
import { RiskRepository } from '../modules/risk/risk.repository';
import { PrismaService } from './prisma.service';
import { TransactionService } from './transaction.service';

const repositories = [
  AuditRepository,
  CallRepository,
  EnrollmentRepository,
  EvidenceRepository,
  GovernanceRepository,
  IdentityRepository,
  RiskRepository,
];

@Global()
@Module({
  providers: [PrismaService, TransactionService, ...repositories],
  exports: [PrismaService, TransactionService, ...repositories],
})
export class PrismaModule {}
