import { Injectable } from '@nestjs/common';

import { AuditOutcome, type AuditLog } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { AuditRepository } from './audit.repository';

export interface WorkflowAuditInput {
  organizationId: string;
  actor?: AuthPrincipal;
  correlationId: string;
  idempotencyKey?: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome?: AuditOutcome;
  reasonCode?: string;
  operation: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  record(input: WorkflowAuditInput): Promise<AuditLog> {
    return this.repository.append(
      { organizationId: input.organizationId },
      {
        ...(input.actor === undefined ? {} : { actorMembershipId: input.actor.membershipId }),
        correlationId: input.correlationId,
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        outcome: input.outcome ?? AuditOutcome.SUCCEEDED,
        ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
        nonSensitiveMetadata: { operation: input.operation },
      },
    );
  }
}
