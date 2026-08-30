import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  AuditOutcome,
  RiskState,
  type EvidenceEvent,
  type ModelVersion,
} from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { evaluateRiskEvidence, type RiskEngineEvidence } from './risk-engine';
import { RiskActivationGateService } from './risk-activation-gate.service';
import { RiskRepository } from './risk.repository';
import { parseRiskPolicyDocument, RiskPolicyValidationError } from './risk-policy';

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

@Injectable()
export class RiskDecisionService {
  constructor(
    private readonly risk: RiskRepository,
    private readonly activation: RiskActivationGateService,
    private readonly audit: AuditService,
  ) {}

  async assessAcceptedEvidence(input: {
    organizationId: string;
    analysisSessionId: string;
    triggerEvidenceEventId: string;
  }) {
    const context = { organizationId: input.organizationId };
    const aggregate = await this.risk.loadDecisionContext(context, input.analysisSessionId);
    let policy;
    try {
      policy = parseRiskPolicyDocument(aggregate.call.riskPolicy.policyDocument);
    } catch (error) {
      if (!(error instanceof RiskPolicyValidationError)) throw error;
      await this.audit.record({
        organizationId: input.organizationId,
        correlationId: input.triggerEvidenceEventId,
        idempotencyKey: `${input.triggerEvidenceEventId}:risk-policy-invalid`,
        action: 'risk.assessment.suppressed',
        targetType: 'EvidenceEvent',
        targetId: input.triggerEvidenceEventId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'RISK_POLICY_INVALID',
        operation: 'risk-assessment',
      });
      return {
        assessmentStatus: 'SUPPRESSED' as const,
        productionEligible: false,
        reasonCode: 'RISK_POLICY_INVALID',
      };
    }
    if (
      aggregate.call.riskPolicyId !== aggregate.call.riskPolicy.id ||
      aggregate.call.riskPolicyVersion !== aggregate.call.riskPolicy.version
    ) {
      throw new Error('The call risk-policy snapshot is inconsistent.');
    }
    const result = evaluateRiskEvidence(
      aggregate.evidenceEvents.map((event) => engineEvidence(event)),
      policy,
    );
    const activation = this.activation.evaluate(policy, {
      evidenceMode: aggregate.evidenceMode,
      sufficientEvidence: result.outcome !== 'INSUFFICIENT_EVIDENCE',
      allScoresCalibrated: result.allScoresCalibrated,
      calibrationVersions: result.calibrationVersions,
      allModelsActiveAndTraceable: result.allModelsActiveAndTraceable,
    });
    const hash = evidenceSetHash(aggregate.evidenceEvents);
    const previous = await this.risk.findLatestAssessment(context, aggregate.id);
    const replayingSameEvidenceSet = previous?.evidenceSetHashSha256 === hash;
    const priorState = replayingSameEvidenceSet
      ? previous.priorState
      : (previous?.effectiveState ?? RiskState.UNVERIFIED);
    const assessment = await this.risk.recordAssessment(context, {
      callId: aggregate.callId,
      analysisSessionId: aggregate.id,
      riskPolicyId: aggregate.call.riskPolicy.id,
      idempotencyKey: `risk-assessment:${aggregate.id}:${hash}`,
      schemaVersion: '1.0.0',
      evidenceSetHashSha256: hash,
      evidenceMode: aggregate.evidenceMode,
      decisionMode: activation.decisionMode,
      outcome: result.outcome,
      priorState,
      effectiveState: result.effectiveState,
      transitioned: replayingSameEvidenceSet
        ? previous.transitioned
        : priorState !== result.effectiveState,
      productionEligible: activation.productionEligible,
      activationSuppressed: activation.activationSuppressed,
      reasonCode: activation.productionEligible
        ? result.reasonCode
        : (activation.blockerCodes[0] ?? 'PRODUCTION_ACTIVATION_SUPPRESSED'),
      policyKey: aggregate.call.riskPolicy.policyKey,
      policyVersion: aggregate.call.riskPolicy.version,
      thresholdVersion: policy.thresholdVersion,
      ...(policy.calibrationVersion === null
        ? {}
        : { calibrationVersion: policy.calibrationVersion }),
      proposedInterventions: result.proposedInterventions,
      maxWindowSequence: result.maxWindowSequence,
      occurredAt: result.occurredAt,
      evidenceEventIds: result.evidenceEventIds,
      audit: {
        correlationId: input.triggerEvidenceEventId,
        idempotencyKey: `${input.triggerEvidenceEventId}:risk-assessment-audit`,
      },
    });
    return {
      assessmentStatus: 'RECORDED' as const,
      riskAssessmentId: assessment.id,
      outcome: assessment.outcome,
      effectiveState: assessment.effectiveState,
      decisionMode: assessment.decisionMode,
      productionEligible: assessment.productionEligible,
      activationSuppressed: assessment.activationSuppressed,
      reasonCode: assessment.reasonCode,
    };
  }
}
