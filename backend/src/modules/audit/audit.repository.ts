import { Injectable } from '@nestjs/common';

import { type AuditLog, type AuditOutcome, type Prisma } from '../../generated/prisma/client';
import { IdempotencyConflictError } from '../../database/database.errors';
import {
  requireTenant,
  requireText,
  requireUuid,
  type TenantContext,
  type TransactionClient,
} from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';

export interface AllowedAuditMetadata {
  operation?: string;
  policyVersion?: string;
  schemaVersion?: string;
}

export interface AppendAuditInput {
  actorMembershipId?: string;
  correlationId: string;
  idempotencyKey?: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  reasonCode?: string;
  sourceIpHash?: string;
  nonSensitiveMetadata?: AllowedAuditMetadata;
  occurredAt?: Date;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(context: TenantContext, input: AppendAuditInput): Promise<AuditLog> {
    const organizationId = requireTenant(context);
    if (input.idempotencyKey !== undefined) {
      const existing = await this.prisma.client.auditLog.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId,
            idempotencyKey: requireText(input.idempotencyKey, 'idempotencyKey', 128),
          },
        },
      });
      if (existing !== null) {
        if (
          existing.action !== input.action ||
          existing.targetType !== input.targetType ||
          existing.targetId !== input.targetId ||
          existing.outcome !== input.outcome
        ) {
          throw new IdempotencyConflictError();
        }
        return existing;
      }
    }
    return this.appendWithClient(this.prisma.client, context, input);
  }

  appendWithClient(
    client: TransactionClient | PrismaService['client'],
    context: TenantContext,
    input: AppendAuditInput,
  ): Promise<AuditLog> {
    const organizationId = requireTenant(context);
    const metadata = input.nonSensitiveMetadata;
    const normalizedMetadata: Prisma.InputJsonValue | undefined =
      metadata === undefined
        ? undefined
        : {
            ...(metadata.operation === undefined
              ? {}
              : {
                  operation: requireText(metadata.operation, 'auditMetadata.operation', 160),
                }),
            ...(metadata.policyVersion === undefined
              ? {}
              : {
                  policyVersion: requireText(
                    metadata.policyVersion,
                    'auditMetadata.policyVersion',
                    160,
                  ),
                }),
            ...(metadata.schemaVersion === undefined
              ? {}
              : {
                  schemaVersion: requireText(
                    metadata.schemaVersion,
                    'auditMetadata.schemaVersion',
                    160,
                  ),
                }),
          };
    return client.auditLog.create({
      data: {
        organizationId,
        actorMembershipId:
          input.actorMembershipId === undefined
            ? null
            : requireUuid(input.actorMembershipId, 'actorMembershipId'),
        correlationId: requireText(input.correlationId, 'correlationId', 128),
        idempotencyKey:
          input.idempotencyKey === undefined
            ? null
            : requireText(input.idempotencyKey, 'idempotencyKey', 128),
        action: requireText(input.action, 'action', 120),
        targetType: requireText(input.targetType, 'targetType', 80),
        targetId: requireUuid(input.targetId, 'targetId'),
        outcome: input.outcome,
        reasonCode:
          input.reasonCode === undefined ? null : requireText(input.reasonCode, 'reasonCode', 80),
        sourceIpHash:
          input.sourceIpHash === undefined
            ? null
            : requireText(input.sourceIpHash, 'sourceIpHash', 64),
        ...(normalizedMetadata === undefined ? {} : { nonSensitiveMetadata: normalizedMetadata }),
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  }
}
