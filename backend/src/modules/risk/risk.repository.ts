import { Injectable } from '@nestjs/common';

import {
  AlertStatus,
  AuditOutcome,
  EvidenceMode,
  EvidenceReadiness,
  EvidenceType,
  InterventionStatus,
  ModelLifecycleStatus,
  Prisma,
  VerificationStatus,
  type Alert,
  type AlertChannel,
  type Intervention,
  type InterventionType,
  type RiskEvent,
  type RiskAssessment,
  type RiskAssessmentOutcome,
  type RiskDecisionMode,
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
import { ConfigurationService } from '../../config/configuration';
import { AuditRepository } from '../audit/audit.repository';
import { parseRiskPolicyDocument, RiskPolicyValidationError } from './risk-policy';

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

export interface RecordRiskAssessmentInput {
  callId: string;
  analysisSessionId: string;
  riskPolicyId: string;
  idempotencyKey: string;
  schemaVersion: string;
  evidenceSetHashSha256: string;
  evidenceMode: EvidenceMode;
  decisionMode: RiskDecisionMode;
  outcome: RiskAssessmentOutcome;
  priorState: RiskState;
  effectiveState: RiskState;
  transitioned: boolean;
  productionEligible: boolean;
  activationSuppressed: boolean;
  reasonCode: string;
  policyKey: string;
  policyVersion: string;
  thresholdVersion: string;
  calibrationVersion?: string;
  proposedInterventions: InterventionType[];
  maxWindowSequence: bigint;
  occurredAt: Date;
  evidenceEventIds: string[];
  audit: {
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

export type RiskDecisionContext = Prisma.AnalysisSessionGetPayload<{
  include: {
    call: { include: { riskPolicy: true } };
    evidenceEvents: { include: { modelVersionRef: true } };
  };
}>;

type RiskAssessmentAggregate = Prisma.RiskAssessmentGetPayload<{
  include: { evidenceLinks: true };
}>;

@Injectable()
export class RiskRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly auditRepository: AuditRepository,
    private readonly configuration: ConfigurationService,
  ) {}

  async loadDecisionContext(
    context: TenantContext,
    analysisSessionId: string,
  ): Promise<RiskDecisionContext> {
    const organizationId = requireTenant(context);
    const aggregate = await this.prisma.client.analysisSession.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: requireUuid(analysisSessionId, 'analysisSessionId'),
        },
      },
      include: {
        call: { include: { riskPolicy: true } },
        evidenceEvents: {
          where: { acceptanceStatus: 'ACCEPTED' },
          include: { modelVersionRef: true },
          orderBy: [{ windowSequence: 'asc' }, { eventSequence: 'asc' }],
        },
      },
    });
    if (aggregate === null) throw new TenantResourceNotFoundError('Analysis session');
    return aggregate;
  }

  findLatestAssessment(
    context: TenantContext,
    analysisSessionId: string,
  ): Promise<RiskAssessment | null> {
    const organizationId = requireTenant(context);
    return this.prisma.client.riskAssessment.findFirst({
      where: {
        organizationId,
        analysisSessionId: requireUuid(analysisSessionId, 'analysisSessionId'),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async recordAssessment(
    context: TenantContext,
    input: RecordRiskAssessmentInput,
  ): Promise<RiskAssessmentAggregate> {
    const organizationId = requireTenant(context);
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 128);
    if (!/^[0-9a-f]{64}$/u.test(input.evidenceSetHashSha256)) {
      throw new PersistenceConflictError('Risk assessment evidence hash is invalid.');
    }
    const existing = await this.findAssessmentByIdempotency(organizationId, idempotencyKey);
    if (existing !== null) {
      this.assertAssessmentEquivalent(existing, input);
      return existing;
    }
    try {
      return await this.transactions.serializable(async (transaction) => {
        const callId = requireUuid(input.callId, 'callId');
        const session = await transaction.analysisSession.findUnique({
          where: {
            organizationId_id: {
              organizationId,
              id: requireUuid(input.analysisSessionId, 'analysisSessionId'),
            },
          },
          include: {
            call: {
              select: { riskPolicyId: true, riskPolicyVersion: true },
            },
          },
        });
        if (session === null || session.callId !== callId) {
          throw new TenantResourceNotFoundError('Analysis session');
        }
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
          policy.version !== input.policyVersion ||
          session.call.riskPolicyId !== policy.id ||
          session.call.riskPolicyVersion !== policy.version
        ) {
          throw new TenantResourceNotFoundError('Call-frozen risk policy');
        }
        const evidenceIds = [...new Set(input.evidenceEventIds)].map((id) =>
          requireUuid(id, 'evidenceEventId'),
        );
        const evidenceCount = await transaction.evidenceEvent.count({
          where: {
            organizationId,
            callId,
            analysisSessionId: session.id,
            id: { in: evidenceIds },
            acceptanceStatus: 'ACCEPTED',
            evidenceMode: input.evidenceMode,
          },
        });
        if (evidenceIds.length === 0 || evidenceCount !== evidenceIds.length) {
          throw new TenantResourceNotFoundError('Accepted evidence');
        }
        const assessment = await transaction.riskAssessment.create({
          data: {
            organizationId,
            callId,
            analysisSessionId: session.id,
            riskPolicyId: policy.id,
            idempotencyKey,
            schemaVersion: requireText(input.schemaVersion, 'schemaVersion', 40),
            evidenceSetHashSha256: input.evidenceSetHashSha256,
            evidenceMode: input.evidenceMode,
            decisionMode: input.decisionMode,
            outcome: input.outcome,
            priorState: input.priorState,
            effectiveState: input.effectiveState,
            transitioned: input.transitioned,
            productionEligible: input.productionEligible,
            activationSuppressed: input.activationSuppressed,
            reasonCode: requireText(input.reasonCode, 'reasonCode', 80),
            policyKey: requireText(input.policyKey, 'policyKey', 80),
            policyVersion: requireText(input.policyVersion, 'policyVersion', 40),
            thresholdVersion: requireText(input.thresholdVersion, 'thresholdVersion', 80),
            calibrationVersion: input.calibrationVersion ?? null,
            proposedInterventions: input.proposedInterventions,
            maxWindowSequence: input.maxWindowSequence,
            occurredAt: input.occurredAt,
          },
        });
        await transaction.riskAssessmentEvidence.createMany({
          data: evidenceIds.map((evidenceEventId) => ({
            organizationId,
            riskAssessmentId: assessment.id,
            evidenceEventId,
          })),
        });
        await this.auditRepository.appendWithClient(
          transaction,
          { organizationId },
          {
            correlationId: input.audit.correlationId,
            idempotencyKey: input.audit.idempotencyKey,
            action: 'risk.assessment.recorded',
            targetType: 'RiskAssessment',
            targetId: assessment.id,
            outcome: AuditOutcome.SUCCEEDED,
            reasonCode: input.activationSuppressed
              ? 'PRODUCTION_ACTIVATION_SUPPRESSED'
              : 'PRODUCTION_ELIGIBLE',
            nonSensitiveMetadata: {
              decisionMode: input.decisionMode,
              evidenceMode: input.evidenceMode,
              policyVersion: input.policyVersion,
              thresholdVersion: input.thresholdVersion,
              productionEligible: input.productionEligible,
            },
            occurredAt: input.occurredAt,
          },
        );
        return transaction.riskAssessment.findUniqueOrThrow({
          where: { id: assessment.id },
          include: { evidenceLinks: true },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findAssessmentByIdempotency(organizationId, idempotencyKey);
        if (replay !== null) {
          this.assertAssessmentEquivalent(replay, input);
          return replay;
        }
      }
      throw error;
    }
  }

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
        const call = await transaction.call.findUnique({
          where: { organizationId_id: { organizationId, id: callId } },
        });
        if (
          call === null ||
          call.riskPolicyId !== policy.id ||
          call.riskPolicyVersion !== policy.version
        ) {
          throw new TenantResourceNotFoundError('Call-frozen risk policy');
        }
        if (input.analysisSessionId !== undefined) {
          const session = await transaction.analysisSession.findUnique({
            where: {
              organizationId_id: {
                organizationId,
                id: requireUuid(input.analysisSessionId, 'analysisSessionId'),
              },
            },
          });
          if (session === null || session.callId !== callId) {
            throw new TenantResourceNotFoundError('Call analysis session');
          }
        }
        const evidenceIds = [...new Set(input.evidenceEventIds)].map((id) =>
          requireUuid(id, 'evidenceEventId'),
        );
        if (evidenceIds.length === 0) {
          throw new TenantResourceNotFoundError('Accepted evidence');
        }
        const acceptedEvidence = await transaction.evidenceEvent.findMany({
          where: {
            organizationId,
            callId,
            ...(input.analysisSessionId === undefined
              ? {}
              : { analysisSessionId: input.analysisSessionId }),
            id: { in: evidenceIds },
            acceptanceStatus: 'ACCEPTED',
          },
          include: { modelVersionRef: true },
        });
        if (acceptedEvidence.length !== evidenceIds.length) {
          throw new TenantResourceNotFoundError('Accepted evidence');
        }
        this.assertProductionActivation(policy.policyDocument, acceptedEvidence);
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

  async listRiskAssessments(
    context: TenantContext,
    callId: string,
    request: PageRequest = {},
  ): Promise<PageResult<RiskAssessment>> {
    const organizationId = requireTenant(context);
    const authorizedCallId = requireUuid(callId, 'callId');
    const limit = pageLimit(request.limit);
    const cursor = decodeTimeCursor(request.cursor);
    const assessments = await this.prisma.client.riskAssessment.findMany({
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
    const hasNextPage = assessments.length > limit;
    const items = hasNextPage ? assessments.slice(0, limit) : assessments;
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

  private findAssessmentByIdempotency(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<RiskAssessmentAggregate | null> {
    return this.prisma.client.riskAssessment.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
      include: { evidenceLinks: true },
    });
  }

  private assertProductionActivation(
    policyDocument: Prisma.JsonValue,
    evidence: Array<Prisma.EvidenceEventGetPayload<{ include: { modelVersionRef: true } }>>,
  ): void {
    const gate = this.configuration.values.risk;
    let policy;
    try {
      policy = parseRiskPolicyDocument(policyDocument);
    } catch (error) {
      if (error instanceof RiskPolicyValidationError) {
        throw new PersistenceConflictError('Production risk activation policy is invalid.');
      }
      throw error;
    }
    const eligible =
      gate.interventionMode === 'PRODUCTION' &&
      gate.phaseOScientificStatus === 'PROMOTED' &&
      gate.phasePProductionStatus === 'PROMOTED' &&
      gate.phaseQProductionStatus === 'PROMOTED' &&
      policy.activationMode === 'PRODUCTION' &&
      policy.thresholdClassification === 'PROMOTED_CALIBRATION' &&
      policy.calibrationVersion !== null &&
      evidence.length > 0 &&
      evidence.every((item) => {
        const scoreTargetValid =
          item.evidenceType === EvidenceType.IDENTITY
            ? item.modelVersionRef?.scoreTarget === 'EXPECTED_SPEAKER'
            : item.evidenceType === EvidenceType.SPOOF_FAST ||
                item.evidenceType === EvidenceType.SPOOF_DEEP
              ? item.modelVersionRef?.scoreTarget === 'SPOOF' ||
                item.modelVersionRef?.scoreTarget === 'BONAFIDE'
              : false;
        return (
          item.readiness === EvidenceReadiness.READY &&
          item.evidenceMode === EvidenceMode.CALIBRATED &&
          item.calibratedScore !== null &&
          item.calibrationVersion === policy.calibrationVersion &&
          item.modelVersionRef !== null &&
          item.modelVersionRef.status === ModelLifecycleStatus.ACTIVE &&
          item.modelVersionRef.scoreTarget !== null &&
          item.modelVersionRef.modelName === item.modelName &&
          item.modelVersionRef.version === item.modelVersion &&
          item.modelVersionRef.checkpointHashSha256 === item.checkpointHashSha256 &&
          item.modelVersionRef.scoreName === item.scoreName &&
          item.modelVersionRef.scoreDirection === item.scoreDirection &&
          scoreTargetValid
        );
      });
    if (!eligible) {
      throw new PersistenceConflictError(
        'Production risk activation is blocked by scientific or serving promotion gates.',
      );
    }
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

  private assertAssessmentEquivalent(
    existing: RiskAssessmentAggregate,
    input: RecordRiskAssessmentInput,
  ): void {
    const existingEvidenceIds = existing.evidenceLinks
      .map(({ evidenceEventId }) => evidenceEventId)
      .sort();
    const inputEvidenceIds = [...new Set(input.evidenceEventIds)].sort();
    if (
      existing.callId !== input.callId ||
      existing.analysisSessionId !== input.analysisSessionId ||
      existing.riskPolicyId !== input.riskPolicyId ||
      existing.schemaVersion !== input.schemaVersion ||
      existing.evidenceSetHashSha256 !== input.evidenceSetHashSha256 ||
      existing.evidenceMode !== input.evidenceMode ||
      existing.decisionMode !== input.decisionMode ||
      existing.outcome !== input.outcome ||
      existing.priorState !== input.priorState ||
      existing.effectiveState !== input.effectiveState ||
      existing.transitioned !== input.transitioned ||
      existing.productionEligible !== input.productionEligible ||
      existing.activationSuppressed !== input.activationSuppressed ||
      existing.reasonCode !== input.reasonCode ||
      existing.policyKey !== input.policyKey ||
      existing.policyVersion !== input.policyVersion ||
      existing.thresholdVersion !== input.thresholdVersion ||
      existing.calibrationVersion !== (input.calibrationVersion ?? null) ||
      existing.maxWindowSequence !== input.maxWindowSequence ||
      existing.occurredAt.getTime() !== input.occurredAt.getTime() ||
      JSON.stringify(existing.proposedInterventions) !==
        JSON.stringify(input.proposedInterventions) ||
      JSON.stringify(existingEvidenceIds) !== JSON.stringify(inputEvidenceIds)
    ) {
      throw new IdempotencyConflictError();
    }
  }
}
