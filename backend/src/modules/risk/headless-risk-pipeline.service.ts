import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { SafeLogger } from '../../common/logging/safe-logger.service';
import { OperationalTelemetryService } from '../../common/logging/operational-telemetry.service';
import { ConfigurationService } from '../../config/configuration';
import { TransactionService } from '../../database/transaction.service';
import {
  AlertChannel,
  AlertStatus,
  AuditOutcome,
  EvidenceAcceptanceStatus,
  EvidenceMode,
  InterventionStatus,
  InterventionType,
  Prisma,
  RiskState,
  SecurityControlMode,
  type Alert,
  type EvidenceEvent,
  type ModelVersion,
} from '../../generated/prisma/client';
import { AuditRepository } from '../audit/audit.repository';
import { EvidenceRepository, type RecordEvidenceInput } from '../evidence/evidence.repository';
import { evaluateRiskEvidence, type RiskEngineEvidence } from './risk-engine';
import { RiskActivationGateService } from './risk-activation-gate.service';
import { parseRiskPolicyDocument, RiskPolicyValidationError } from './risk-policy';

type DecisionContext = Prisma.AnalysisSessionGetPayload<{
  include: {
    call: { include: { riskPolicy: true } };
    evidenceEvents: { include: { modelVersionRef: true } };
  };
}>;

export interface HeadlessPipelineResult {
  evidenceEventId: string;
  acceptanceStatus: EvidenceAcceptanceStatus;
  riskAssessment: {
    assessmentStatus: 'RECORDED' | 'SUPPRESSED';
    riskAssessmentId?: string;
    outcome?: string;
    effectiveState?: string;
    decisionMode?: string;
    productionEligible: boolean;
    activationSuppressed?: boolean;
    reasonCode: string;
    mode?: SecurityControlMode;
    riskEventId?: string;
    interventionIds?: string[];
    outboxIds?: string[];
  };
}

function evidenceSetHash(events: EvidenceEvent[]): string {
  const canonical = events
    .map((event) => ({
      id: event.id,
      eventSequence: event.eventSequence.toString(),
      windowSequence: event.windowSequence.toString(),
      evidenceType: event.evidenceType,
      revision: event.revision,
      acceptanceStatus: event.acceptanceStatus,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function externalEventId(input: {
  organizationId: string;
  eventType: string;
  targetId: string;
  idempotencyKey: string;
}): string {
  return `evt_${createHash('sha256')
    .update(`${input.organizationId}:${input.eventType}:${input.targetId}:${input.idempotencyKey}`)
    .digest('hex')}`;
}

function engineEvidence(
  event: EvidenceEvent & { modelVersionRef: ModelVersion | null },
): RiskEngineEvidence {
  const model = event.modelVersionRef;
  return {
    id: event.id,
    evidenceMode: event.evidenceMode,
    evidenceType: event.evidenceType,
    readiness: event.readiness,
    windowSequence: event.windowSequence,
    eventSequence: event.eventSequence,
    revision: event.revision,
    observedAt: event.observedAt,
    qualityScore: event.qualityScore === null ? null : Number(event.qualityScore),
    speechDurationMs: event.speechDurationMs,
    reasonCodes: event.reasonCodes,
    rawScore: event.rawScore === null ? null : Number(event.rawScore),
    calibratedScore: event.calibratedScore === null ? null : Number(event.calibratedScore),
    calibrationVersion: event.calibrationVersion,
    scoreDirection: event.scoreDirection,
    scoreTarget: model?.scoreTarget ?? null,
    modelStatus: model?.status ?? null,
    modelTraceMatches:
      model !== null &&
      model.id === event.modelVersionId &&
      model.modelName === event.modelName &&
      model.version === event.modelVersion &&
      model.checkpointHashSha256 === event.checkpointHashSha256 &&
      model.scoreName === event.scoreName &&
      model.scoreDirection === event.scoreDirection,
  };
}

function controlMode(evidenceMode: EvidenceMode, productionEligible: boolean): SecurityControlMode {
  if (productionEligible) return SecurityControlMode.PRODUCTION;
  return evidenceMode === EvidenceMode.SIMULATED
    ? SecurityControlMode.DEMO
    : SecurityControlMode.SHADOW;
}

function isConcurrentWriteConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2034')
  ) {
    return true;
  }
  return error instanceof Error && error.message.includes('TransactionWriteConflict');
}

@Injectable()
export class HeadlessRiskPipelineService {
  constructor(
    private readonly transactions: TransactionService,
    private readonly evidence: EvidenceRepository,
    private readonly audits: AuditRepository,
    private readonly activation: RiskActivationGateService,
    private readonly configuration: ConfigurationService,
    private readonly logger: SafeLogger,
    private readonly telemetry: OperationalTelemetryService,
  ) {}

  async ingestAcceptedEvidence(input: {
    organizationId: string;
    evidence: RecordEvidenceInput;
  }): Promise<HeadlessPipelineResult> {
    let result: HeadlessPipelineResult | undefined;
    const maximumAttempts = 3;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        result = await this.transactions.serializable(async (transaction) => {
          const context = { organizationId: input.organizationId };
          const event = await this.evidence.recordWithClient(transaction, context, input.evidence);
          if (event.acceptanceStatus !== EvidenceAcceptanceStatus.ACCEPTED) {
            return {
              evidenceEventId: event.id,
              acceptanceStatus: event.acceptanceStatus,
              riskAssessment: {
                assessmentStatus: 'SUPPRESSED' as const,
                productionEligible: false,
                reasonCode: 'EVIDENCE_NOT_ACCEPTED_FOR_RISK',
              },
            };
          }

          const aggregate = await transaction.analysisSession.findUniqueOrThrow({
            where: {
              organizationId_id: {
                organizationId: input.organizationId,
                id: event.analysisSessionId,
              },
            },
            include: {
              call: { include: { riskPolicy: true } },
              evidenceEvents: {
                where: { acceptanceStatus: EvidenceAcceptanceStatus.ACCEPTED },
                include: { modelVersionRef: true },
                orderBy: [{ windowSequence: 'asc' }, { eventSequence: 'asc' }],
              },
            },
          });
          if (
            aggregate.callId !== event.callId ||
            aggregate.trackBindingId !== event.trackBindingId ||
            aggregate.call.riskPolicyId !== aggregate.call.riskPolicy.id ||
            aggregate.call.riskPolicyVersion !== aggregate.call.riskPolicy.version
          ) {
            throw new Error(
              'The tenant-scoped analysis binding or risk-policy snapshot is invalid.',
            );
          }
          return this.recordDecision(transaction, aggregate, event);
        });
        break;
      } catch (error) {
        if (!isConcurrentWriteConflict(error) || attempt === maximumAttempts) throw error;
      }
    }
    if (result === undefined) throw new Error('Atomic evidence processing did not complete.');

    this.logger.event('log', 'risk.pipeline.persisted', {
      organizationId: input.organizationId,
      analysisSessionId: input.evidence.analysisSessionId,
      riskAssessmentId: result.riskAssessment.riskAssessmentId ?? null,
      riskEventId: result.riskAssessment.riskEventId ?? null,
      mode: result.riskAssessment.mode ?? null,
      outcome: result.riskAssessment.outcome ?? result.riskAssessment.reasonCode,
      deliveryStatus: result.riskAssessment.outboxIds?.length ? 'OUTBOX_PENDING' : 'NO_OUTBOX',
    });
    this.telemetry.increment('swar_backend_risk_assessments_total', {
      outcome: result.riskAssessment.outcome ?? 'SUPPRESSED',
      mode: result.riskAssessment.mode ?? 'NONE',
    });
    if (result.riskAssessment.riskEventId !== undefined) {
      this.telemetry.increment('swar_backend_risk_transitions_total', {
        state: result.riskAssessment.effectiveState ?? 'UNVERIFIED',
        mode: result.riskAssessment.mode ?? 'SHADOW',
      });
    }
    this.telemetry.gauge(
      'swar_backend_security_outbox_pending_created',
      result.riskAssessment.outboxIds?.length ?? 0,
    );
    return result;
  }

  private async recordDecision(
    transaction: Prisma.TransactionClient,
    aggregate: DecisionContext,
    trigger: EvidenceEvent,
  ): Promise<HeadlessPipelineResult> {
    let policy;
    try {
      policy = parseRiskPolicyDocument(aggregate.call.riskPolicy.policyDocument);
    } catch (error) {
      if (!(error instanceof RiskPolicyValidationError)) throw error;
      await this.audits.appendWithClient(
        transaction,
        { organizationId: aggregate.organizationId },
        {
          correlationId: trigger.id,
          idempotencyKey: `${trigger.id}:risk-policy-invalid`,
          action: 'risk.assessment.suppressed',
          targetType: 'EvidenceEvent',
          targetId: trigger.id,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'RISK_POLICY_INVALID',
          nonSensitiveMetadata: { operation: 'headless-risk-pipeline' },
        },
      );
      return {
        evidenceEventId: trigger.id,
        acceptanceStatus: trigger.acceptanceStatus,
        riskAssessment: {
          assessmentStatus: 'SUPPRESSED',
          productionEligible: false,
          reasonCode: 'RISK_POLICY_INVALID',
        },
      };
    }

    const evaluated = evaluateRiskEvidence(
      aggregate.evidenceEvents.map((event) => engineEvidence(event)),
      policy,
    );
    const activation = this.activation.evaluate(policy, {
      evidenceMode: aggregate.evidenceMode,
      sufficientEvidence: evaluated.outcome !== 'INSUFFICIENT_EVIDENCE',
      allScoresCalibrated: evaluated.allScoresCalibrated,
      calibrationVersions: evaluated.calibrationVersions,
      allModelsActiveAndTraceable: evaluated.allModelsActiveAndTraceable,
    });
    const hash = evidenceSetHash(aggregate.evidenceEvents);
    const replay = await transaction.riskAssessment.findUnique({
      where: {
        organizationId_analysisSessionId_evidenceSetHashSha256: {
          organizationId: aggregate.organizationId,
          analysisSessionId: aggregate.id,
          evidenceSetHashSha256: hash,
        },
      },
    });
    if (replay !== null) {
      const replayEvent = await transaction.riskEvent.findUnique({
        where: {
          organizationId_riskAssessmentId: {
            organizationId: aggregate.organizationId,
            riskAssessmentId: replay.id,
          },
        },
        include: { interventions: true, alerts: true },
      });
      return this.response(trigger, replay, replayEvent);
    }

    const previous = await transaction.riskAssessment.findFirst({
      where: { organizationId: aggregate.organizationId, analysisSessionId: aggregate.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const priorState = previous?.effectiveState ?? RiskState.UNVERIFIED;
    const transitioned = priorState !== evaluated.effectiveState;
    const mode = controlMode(aggregate.evidenceMode, activation.productionEligible);
    this.assertModeAllowed(mode, activation.productionEligible);
    const assessment = await transaction.riskAssessment.create({
      data: {
        organizationId: aggregate.organizationId,
        callId: aggregate.callId,
        analysisSessionId: aggregate.id,
        riskPolicyId: aggregate.call.riskPolicy.id,
        idempotencyKey: `risk-assessment:${aggregate.id}:${hash}`,
        schemaVersion: '1.1.0',
        evidenceSetHashSha256: hash,
        evidenceMode: aggregate.evidenceMode,
        decisionMode: activation.decisionMode,
        outcome: evaluated.outcome,
        priorState,
        effectiveState: evaluated.effectiveState,
        transitioned,
        productionEligible: activation.productionEligible,
        activationSuppressed: activation.activationSuppressed,
        activationBlockerCodes: activation.blockerCodes,
        reasonCode: evaluated.reasonCode,
        policyKey: aggregate.call.riskPolicy.policyKey,
        policyVersion: aggregate.call.riskPolicy.version,
        thresholdVersion: policy.thresholdVersion,
        calibrationVersion: policy.calibrationVersion,
        proposedInterventions: evaluated.proposedInterventions,
        maxWindowSequence: evaluated.maxWindowSequence,
        occurredAt: evaluated.occurredAt,
      },
    });
    await transaction.riskAssessmentEvidence.createMany({
      data: evaluated.evidenceEventIds.map((evidenceEventId) => ({
        organizationId: aggregate.organizationId,
        riskAssessmentId: assessment.id,
        evidenceEventId,
      })),
    });
    await this.audits.appendWithClient(
      transaction,
      { organizationId: aggregate.organizationId },
      {
        correlationId: trigger.id,
        idempotencyKey: `${assessment.id}:audit`,
        action: 'risk.assessment.recorded',
        targetType: 'RiskAssessment',
        targetId: assessment.id,
        outcome: AuditOutcome.SUCCEEDED,
        reasonCode: activation.activationSuppressed
          ? 'PRODUCTION_ACTIVATION_SUPPRESSED'
          : 'PRODUCTION_ELIGIBLE',
        nonSensitiveMetadata: {
          operation: 'headless-risk-pipeline',
          policyVersion: aggregate.call.riskPolicy.version,
          schemaVersion: '1.1.0',
          decisionMode: activation.decisionMode,
          evidenceMode: aggregate.evidenceMode,
          thresholdVersion: policy.thresholdVersion,
          productionEligible: activation.productionEligible,
          controlMode: mode,
        },
        occurredAt: evaluated.occurredAt,
      },
    );

    if (!transitioned || evaluated.outcome === 'INSUFFICIENT_EVIDENCE') {
      return this.response(trigger, assessment, null);
    }

    const maximum = await transaction.riskEvent.aggregate({
      where: { organizationId: aggregate.organizationId, callId: aggregate.callId },
      _max: { eventSequence: true },
    });
    const riskEvent = await transaction.riskEvent.create({
      data: {
        organizationId: aggregate.organizationId,
        callId: aggregate.callId,
        analysisSessionId: aggregate.id,
        riskPolicyId: aggregate.call.riskPolicy.id,
        riskAssessmentId: assessment.id,
        idempotencyKey: `risk-event:${assessment.id}`,
        schemaVersion: '1.1.0',
        eventSequence: (maximum._max.eventSequence ?? 0n) + 1n,
        mode,
        priorState,
        state: evaluated.effectiveState,
        transitionReasonCode: evaluated.reasonCode,
        policyKey: aggregate.call.riskPolicy.policyKey,
        policyVersion: aggregate.call.riskPolicy.version,
        thresholdVersion: policy.thresholdVersion,
        occurredAt: evaluated.occurredAt,
      },
    });
    await transaction.riskEventEvidence.createMany({
      data: evaluated.evidenceEventIds.map((evidenceEventId) => ({
        organizationId: aggregate.organizationId,
        riskEventId: riskEvent.id,
        evidenceEventId,
      })),
    });

    const interventionInputs =
      mode === SecurityControlMode.SHADOW
        ? []
        : evaluated.proposedInterventions.filter(
            (type) =>
              type !== InterventionType.HOLD_PROTECTED_ACTION ||
              aggregate.call.protectedActionReference !== null,
          );
    const interventions = [];
    for (const type of interventionInputs) {
      interventions.push(
        await transaction.intervention.create({
          data: {
            organizationId: aggregate.organizationId,
            callId: aggregate.callId,
            riskEventId: riskEvent.id,
            idempotencyKey: `intervention:${assessment.id}:${type}`,
            type,
            status: InterventionStatus.REQUIRED,
            mode,
            policyVersion: aggregate.call.riskPolicy.version,
            reasonCode: evaluated.reasonCode,
            protectedActionReference:
              type === InterventionType.HOLD_PROTECTED_ACTION
                ? aggregate.call.protectedActionReference
                : null,
            requiredAt: evaluated.occurredAt,
          },
        }),
      );
    }

    const outbox: Alert[] = [];
    const enqueue = async (
      eventType: 'risk.state.changed' | 'intervention.required' | 'dashboard.risk-event.created',
      targetId: string,
      interventionId?: string,
    ) => {
      const idempotencyKey = `security-event:${assessment.id}:${eventType}:${targetId}`;
      outbox.push(
        await transaction.alert.create({
          data: {
            organizationId: aggregate.organizationId,
            callId: aggregate.callId,
            riskEventId: riskEvent.id,
            interventionId: interventionId ?? null,
            idempotencyKey,
            externalEventId: externalEventId({
              organizationId: aggregate.organizationId,
              eventType,
              targetId,
              idempotencyKey,
            }),
            channel: AlertChannel.SECURITY_WEBSOCKET,
            status: AlertStatus.PENDING,
            mode,
            eventType,
            schemaVersion: '1.1.0',
          },
        }),
      );
    };
    await enqueue('dashboard.risk-event.created', riskEvent.id);
    if (mode !== SecurityControlMode.SHADOW) {
      await enqueue('risk.state.changed', riskEvent.id);
      for (const intervention of interventions) {
        await enqueue('intervention.required', intervention.id, intervention.id);
      }
    }
    await this.audits.appendWithClient(
      transaction,
      { organizationId: aggregate.organizationId },
      {
        correlationId: trigger.id,
        idempotencyKey: `${riskEvent.id}:audit`,
        action: 'risk.transition.recorded',
        targetType: 'RiskEvent',
        targetId: riskEvent.id,
        outcome: AuditOutcome.SUCCEEDED,
        nonSensitiveMetadata: {
          operation: 'headless-risk-pipeline',
          policyVersion: aggregate.call.riskPolicy.version,
          schemaVersion: '1.1.0',
          controlMode: mode,
          productionEligible: activation.productionEligible,
        },
        occurredAt: evaluated.occurredAt,
      },
    );
    return this.response(trigger, assessment, { ...riskEvent, interventions, alerts: outbox });
  }

  private assertModeAllowed(mode: SecurityControlMode, productionEligible: boolean): void {
    const gate = this.configuration.values.risk;
    if (mode === SecurityControlMode.PRODUCTION && !productionEligible) {
      throw new Error('Production controls require production-eligible evidence.');
    }
    if (
      mode === SecurityControlMode.PRODUCTION &&
      (gate.interventionMode !== 'PRODUCTION' ||
        gate.phaseOScientificStatus !== 'PROMOTED' ||
        gate.phasePProductionStatus !== 'PROMOTED' ||
        gate.phaseQProductionStatus !== 'PROMOTED')
    ) {
      throw new Error('Production controls are blocked by O/P/Q promotion gates.');
    }
    if (
      this.configuration.values.runtime.environment === 'production' &&
      mode !== SecurityControlMode.PRODUCTION
    ) {
      throw new Error('DEMO and SHADOW intervention delivery are prohibited in production.');
    }
  }

  private response(
    trigger: EvidenceEvent,
    assessment: {
      id: string;
      outcome: string;
      effectiveState: string;
      decisionMode: string;
      productionEligible: boolean;
      activationSuppressed: boolean;
      reasonCode: string;
      evidenceMode: EvidenceMode;
    },
    riskEvent: {
      id: string;
      mode: SecurityControlMode;
      interventions: Array<{ id: string }>;
      alerts: Array<{ id: string }>;
    } | null,
  ): HeadlessPipelineResult {
    return {
      evidenceEventId: trigger.id,
      acceptanceStatus: trigger.acceptanceStatus,
      riskAssessment: {
        assessmentStatus: 'RECORDED',
        riskAssessmentId: assessment.id,
        outcome: assessment.outcome,
        effectiveState: assessment.effectiveState,
        decisionMode: assessment.decisionMode,
        productionEligible: assessment.productionEligible,
        activationSuppressed: assessment.activationSuppressed,
        reasonCode: assessment.reasonCode,
        mode:
          riskEvent?.mode ?? controlMode(assessment.evidenceMode, assessment.productionEligible),
        ...(riskEvent === null
          ? {}
          : {
              riskEventId: riskEvent.id,
              interventionIds: riskEvent.interventions.map(({ id }) => id),
              outboxIds: riskEvent.alerts.map(({ id }) => id),
            }),
      },
    };
  }
}
