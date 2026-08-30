import { Injectable } from '@nestjs/common';

import {
  AlertStatus,
  AuditOutcome,
  InterventionStatus,
  Prisma,
  VerificationStatus,
  type Alert,
  type AlertChannel,
  type Intervention,
  type InterventionType,
  type RiskEvent,
  type RiskState,
  type VerificationChallenge,
} from '../../generated/prisma/client';
import {
  IdempotencyConflictError,
  PersistenceConflictError,
  TenantResourceNotFoundError,
} from '../../database/database.errors';
import {
  decodeTimeCursor,
  encodeTimeCursor,
  pageLimit,
  type PageRequest,
  type PageResult,
} from '../../database/pagination';
import {
  requireTenant,
  requireText,
  requireUuid,
  type TenantContext,
} from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../../database/transaction.service';
import { AuditRepository } from '../audit/audit.repository';

export interface InterventionWriteInput {
  idempotencyKey: string;
  type: InterventionType;
  policyVersion: string;
  reasonCode: string;
  protectedActionReference?: string;
  expiresAt?: Date;
}

export interface AlertWriteInput {
  idempotencyKey: string;
  channel: AlertChannel;
  eventType: string;
  schemaVersion: string;
  recipientReference?: string;
  interventionIndex?: number;
}

export interface RecordRiskTransitionInput {
  callId: string;
  analysisSessionId?: string;
  riskPolicyId: string;
  idempotencyKey: string;
  schemaVersion: string;
  eventSequence: bigint;
  priorState: RiskState;
  state: RiskState;
  transitionReasonCode: string;
  policyKey: string;
  policyVersion: string;
  thresholdVersion: string;
  occurredAt: Date;
  evidenceEventIds: string[];
  interventions: InterventionWriteInput[];
  alerts: AlertWriteInput[];
  audit: {
    actorMembershipId?: string;
    correlationId: string;
    idempotencyKey: string;
  };
}

type RiskEventAggregate = Prisma.RiskEventGetPayload<{
  include: {
    evidenceLinks: true;
    interventions: true;
    alerts: true;
  };
}>;

@Injectable()
export class RiskRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly auditRepository: AuditRepository,
  ) {}

  async recordTransition(
    context: TenantContext,
    input: RecordRiskTransitionInput,
  ): Promise<RiskEventAggregate> {
    const organizationId = requireTenant(context);
    const callId = requireUuid(input.callId, 'callId');
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 128);
    if (input.eventSequence < 0n || input.priorState === input.state) {
      throw new PersistenceConflictError('Risk transition sequence/state is invalid.');
    }
    const existing = await this.findByIdempotency(organizationId, idempotencyKey);
    if (existing !== null) {
      this.assertEquivalent(existing, input);
      return existing;
    }

    try {
      return await this.transactions.serializable(async (transaction) => {
        const policy = await transaction.riskPolicy.findUnique({
          where: {
            organizationId_id: {
              organizationId,
              id: requireUuid(input.riskPolicyId, 'riskPolicyId'),
            },
          },
        });
        if (
          policy === null ||
          policy.policyKey !== input.policyKey ||
          policy.version !== input.policyVersion
        ) {
          throw new TenantResourceNotFoundError('Versioned risk policy');
        }
        const evidenceIds = [...new Set(input.evidenceEventIds)].map((id) =>
          requireUuid(id, 'evidenceEventId'),
        );
        if (evidenceIds.length === 0) {
          throw new TenantResourceNotFoundError('Accepted evidence');
        }
        const evidenceCount = await transaction.evidenceEvent.count({
          where: {
            organizationId,
            callId,
            id: { in: evidenceIds },
            acceptanceStatus: 'ACCEPTED',
          },
        });
        if (evidenceCount !== evidenceIds.length) {
          throw new TenantResourceNotFoundError('Accepted evidence');
        }
        const riskEvent = await transaction.riskEvent.create({
          data: {
            organizationId,
            callId,
            analysisSessionId:
              input.analysisSessionId === undefined
                ? null
                : requireUuid(input.analysisSessionId, 'analysisSessionId'),
            riskPolicyId: policy.id,
            idempotencyKey,
            schemaVersion: requireText(input.schemaVersion, 'schemaVersion', 40),
            eventSequence: input.eventSequence,
            priorState: input.priorState,
            state: input.state,
            transitionReasonCode: requireText(
              input.transitionReasonCode,
              'transitionReasonCode',
              80,
            ),
            policyKey: requireText(input.policyKey, 'policyKey', 80),
            policyVersion: requireText(input.policyVersion, 'policyVersion', 40),
            thresholdVersion: requireText(input.thresholdVersion, 'thresholdVersion', 80),
            occurredAt: input.occurredAt,
          },
        });
        await transaction.riskEventEvidence.createMany({
          data: evidenceIds.map((evidenceEventId) => ({
            organizationId,
            riskEventId: riskEvent.id,
            evidenceEventId,
          })),
        });

        const interventions: Intervention[] = [];
        for (const interventionInput of input.interventions) {
          interventions.push(
            await transaction.intervention.create({
              data: {
                organizationId,
                callId,
                riskEventId: riskEvent.id,
                idempotencyKey: requireText(
                  interventionInput.idempotencyKey,
                  'intervention.idempotencyKey',
                  128,
                ),
                type: interventionInput.type,
                status: InterventionStatus.REQUIRED,
                policyVersion: requireText(
                  interventionInput.policyVersion,
                  'intervention.policyVersion',
                  40,
                ),
                reasonCode: requireText(
                  interventionInput.reasonCode,
                  'intervention.reasonCode',
                  80,
                ),
                protectedActionReference:
                  interventionInput.protectedActionReference === undefined
                    ? null
                    : requireText(
                        interventionInput.protectedActionReference,
                        'intervention.protectedActionReference',
                        160,
                      ),
                requiredAt: input.occurredAt,
                expiresAt: interventionInput.expiresAt ?? null,
              },
            }),
          );
        }
        for (const alertInput of input.alerts) {
          const intervention =
            alertInput.interventionIndex === undefined
              ? undefined
              : interventions.at(alertInput.interventionIndex);
          if (alertInput.interventionIndex !== undefined && intervention === undefined) {
            throw new PersistenceConflictError('Alert intervention index is invalid.');
          }
          await transaction.alert.create({
            data: {
              organizationId,
              callId,
              riskEventId: riskEvent.id,
              interventionId: intervention?.id ?? null,
              idempotencyKey: requireText(alertInput.idempotencyKey, 'alert.idempotencyKey', 128),
              channel: alertInput.channel,
              status: AlertStatus.PENDING,
              eventType: requireText(alertInput.eventType, 'alert.eventType', 120),
              schemaVersion: requireText(alertInput.schemaVersion, 'alert.schemaVersion', 40),
              recipientReference:
                alertInput.recipientReference === undefined
                  ? null
                  : requireText(alertInput.recipientReference, 'alert.recipientReference', 160),
            },
          });
        }
        await this.auditRepository.appendWithClient(
          transaction,
          { organizationId },
          {
            ...(input.audit.actorMembershipId === undefined
              ? {}
              : { actorMembershipId: input.audit.actorMembershipId }),
            correlationId: input.audit.correlationId,
            idempotencyKey: input.audit.idempotencyKey,
            action: 'risk.transition.recorded',
            targetType: 'RiskEvent',
            targetId: riskEvent.id,
            outcome: AuditOutcome.SUCCEEDED,
            nonSensitiveMetadata: {
              operation: 'risk-transition',
              policyVersion: input.policyVersion,
              schemaVersion: input.schemaVersion,
            },
            occurredAt: input.occurredAt,
          },
        );
        const aggregate = await transaction.riskEvent.findUnique({
          where: { id: riskEvent.id },
          include: { evidenceLinks: true, interventions: true, alerts: true },
        });
        if (aggregate === null) {
          throw new TenantResourceNotFoundError('Risk event');
        }
        return aggregate;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findByIdempotency(organizationId, idempotencyKey);
        if (replay !== null) {
          this.assertEquivalent(replay, input);
          return replay;
        }
      }
      throw error;
    }
  }

  async listRiskEvents(
    context: TenantContext,
    callId: string,
    request: PageRequest = {},
  ): Promise<PageResult<RiskEvent>> {
    const organizationId = requireTenant(context);
    const authorizedCallId = requireUuid(callId, 'callId');
    const limit = pageLimit(request.limit);
    const cursor = decodeTimeCursor(request.cursor);
    const events = await this.prisma.client.riskEvent.findMany({
      where: {
        organizationId,
        callId: authorizedCallId,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { occurredAt: { lt: cursor.timestamp } },
                { occurredAt: cursor.timestamp, id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasNextPage = events.length > limit;
    const items = hasNextPage ? events.slice(0, limit) : events;
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasNextPage && last !== undefined
          ? encodeTimeCursor({ timestamp: last.occurredAt, id: last.id })
          : null,
    };
  }

  async updateInterventionStatus(
    context: TenantContext,
    input: {
      interventionId: string;
      expectedStatus: InterventionStatus;
      nextStatus: InterventionStatus;
      resolvedByMembershipId?: string;
    },
  ): Promise<Intervention> {
    const organizationId = requireTenant(context);
    const id = requireUuid(input.interventionId, 'interventionId');
    const resolved = new Set<InterventionStatus>([
      InterventionStatus.SATISFIED,
      InterventionStatus.DECLINED,
      InterventionStatus.EXPIRED,
      InterventionStatus.CANCELLED,
      InterventionStatus.FAILED,
    ]).has(input.nextStatus);
    const update = await this.prisma.client.intervention.updateMany({
      where: { organizationId, id, status: input.expectedStatus },
      data: {
        status: input.nextStatus,
        ...(input.resolvedByMembershipId === undefined
          ? {}
          : {
              resolvedByMembershipId: requireUuid(
                input.resolvedByMembershipId,
                'resolvedByMembershipId',
              ),
            }),
        ...(resolved ? { resolvedAt: new Date() } : {}),
      },
    });
    if (update.count !== 1) {
      throw new PersistenceConflictError('Intervention state changed concurrently.');
    }
    const intervention = await this.prisma.client.intervention.findUnique({ where: { id } });
    if (intervention === null) {
      throw new TenantResourceNotFoundError('Intervention');
    }
    return intervention;
  }

  async findIntervention(context: TenantContext, interventionId: string): Promise<Intervention> {
    const organizationId = requireTenant(context);
    const intervention = await this.prisma.client.intervention.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: requireUuid(interventionId, 'interventionId'),
        },
      },
    });
    if (intervention === null) throw new TenantResourceNotFoundError('Intervention');
    return intervention;
  }

  async createVerificationChallenge(
    context: TenantContext,
    input: {
      callId: string;
      interventionId: string;
      performedByMembershipId?: string;
      idempotencyKey: string;
      method: string;
      attemptNumber: number;
      expiresAt: Date;
    },
  ): Promise<VerificationChallenge> {
    const organizationId = requireTenant(context);
    if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
      throw new PersistenceConflictError('Verification attempt number is invalid.');
    }
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 128);
    const existing = await this.prisma.client.verificationChallenge.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
    if (existing !== null) {
      if (
        existing.callId !== input.callId ||
        existing.interventionId !== input.interventionId ||
        existing.method !== input.method ||
        existing.attemptNumber !== input.attemptNumber
      ) {
        throw new IdempotencyConflictError();
      }
      return existing;
    }
    try {
      return await this.prisma.client.verificationChallenge.create({
        data: {
          organizationId,
          callId: requireUuid(input.callId, 'callId'),
          interventionId: requireUuid(input.interventionId, 'interventionId'),
          performedByMembershipId:
            input.performedByMembershipId === undefined
              ? null
              : requireUuid(input.performedByMembershipId, 'performedByMembershipId'),
          idempotencyKey,
          method: requireText(input.method, 'method', 80),
          status: VerificationStatus.PENDING,
          attemptNumber: input.attemptNumber,
          requestedAt: new Date(),
          expiresAt: input.expiresAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.prisma.client.verificationChallenge.findUnique({
          where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
        });
        if (replay !== null) return replay;
        throw new IdempotencyConflictError();
      }
      throw error;
    }
  }

  async findVerificationChallenge(
    context: TenantContext,
    challengeId: string,
  ): Promise<VerificationChallenge> {
    const organizationId = requireTenant(context);
    const challenge = await this.prisma.client.verificationChallenge.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: requireUuid(challengeId, 'challengeId'),
        },
      },
    });
    if (challenge === null) throw new TenantResourceNotFoundError('Verification challenge');
    return challenge;
  }

  async completeVerificationChallenge(
    context: TenantContext,
    input: {
      challengeId: string;
      status: Extract<VerificationStatus, 'PASSED' | 'FAILED'>;
      resultCode: string;
    },
  ): Promise<VerificationChallenge> {
    const organizationId = requireTenant(context);
    const id = requireUuid(input.challengeId, 'challengeId');
    const updated = await this.prisma.client.verificationChallenge.updateMany({
      where: {
        organizationId,
        id,
        status: VerificationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      data: {
        status: input.status,
        resultCode: requireText(input.resultCode, 'resultCode', 80),
        completedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      const replay = await this.findVerificationChallenge(context, id);
      if (replay.status === input.status && replay.resultCode === input.resultCode) return replay;
      throw new PersistenceConflictError('Verification challenge is not pending.');
    }
    return this.findVerificationChallenge(context, id);
  }

  async markAlertDelivered(context: TenantContext, alertId: string): Promise<Alert> {
    const organizationId = requireTenant(context);
    const id = requireUuid(alertId, 'alertId');
    const result = await this.prisma.client.alert.updateMany({
      where: { organizationId, id, status: AlertStatus.PENDING },
      data: { status: AlertStatus.DELIVERED, deliveredAt: new Date() },
    });
    if (result.count !== 1) {
      throw new PersistenceConflictError('Alert is not pending.');
    }
    const alert = await this.prisma.client.alert.findUnique({ where: { id } });
    if (alert === null) {
      throw new TenantResourceNotFoundError('Alert');
    }
    return alert;
  }

  private findByIdempotency(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<RiskEventAggregate | null> {
    return this.prisma.client.riskEvent.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
      include: { evidenceLinks: true, interventions: true, alerts: true },
    });
  }

  private assertEquivalent(existing: RiskEventAggregate, input: RecordRiskTransitionInput): void {
    if (
      existing.callId !== input.callId ||
      existing.eventSequence !== input.eventSequence ||
      existing.priorState !== input.priorState ||
      existing.state !== input.state ||
      existing.policyVersion !== input.policyVersion
    ) {
      throw new IdempotencyConflictError();
    }
  }
}
