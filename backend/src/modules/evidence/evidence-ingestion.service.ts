import { HttpStatus, Injectable, Optional } from '@nestjs/common';

import {
  AnalysisSessionStatus,
  CallStatus,
  EvidenceAcceptanceStatus,
  EvidenceMode,
  EvidenceReadiness,
  EvidenceType,
  ScoreDirection,
} from '../../generated/prisma/client';
import { ApiError } from '../../common/errors/api-error';
import { CallRepository } from '../calls/call.repository';
import { RiskDecisionService } from '../risk/risk-decision.service';
import { HeadlessRiskPipelineService } from '../risk/headless-risk-pipeline.service';
import { SecurityEventOutboxService } from '../security-events/security-event-outbox.service';
import { EngineeringInterventionExecutorService } from '../interventions/engineering-intervention-executor.service';
import { MlEvidenceDto, MlEvidenceEventType } from './evidence.contracts';
import { EvidenceRepository } from './evidence.repository';

const terminalCalls = new Set<CallStatus>([
  CallStatus.ENDED,
  CallStatus.CANCELLED,
  CallStatus.FAILED,
]);
const terminalSessions = new Set<AnalysisSessionStatus>([
  AnalysisSessionStatus.STOPPED,
  AnalysisSessionStatus.FAILED,
  AnalysisSessionStatus.EXPIRED,
  AnalysisSessionStatus.REVOKED,
]);

function invalid(fields: string[]): never {
  throw new ApiError(
    'EVIDENCE_CONTRACT_INVALID',
    'The evidence event is invalid.',
    HttpStatus.BAD_REQUEST,
    { fields },
  );
}

function assertSemantics(input: MlEvidenceDto): void {
  if (!['1.0.0', '1.1.0'].includes(input.schemaVersion)) invalid(['schemaVersion']);
  if (input.schemaVersion === '1.1.0' && input.evidenceMode === undefined) {
    invalid(['evidenceMode']);
  }
  const ready =
    input.eventType === MlEvidenceEventType.FAST || input.eventType === MlEvidenceEventType.DEEP;
  if (BigInt(input.windowEndMs) < BigInt(input.windowStartMs)) invalid(['windowEndMs']);
  if (input.calibratedScore !== undefined && input.calibrationVersion === undefined) {
    invalid(['calibrationVersion']);
  }
  if (ready) {
    const expectedTypes =
      input.eventType === MlEvidenceEventType.FAST
        ? new Set<EvidenceType>([EvidenceType.IDENTITY, EvidenceType.SPOOF_FAST])
        : new Set<EvidenceType>([EvidenceType.SPOOF_DEEP]);
    if (!expectedTypes.has(input.evidenceType)) invalid(['eventType', 'evidenceType']);
    if (
      input.modelName === undefined ||
      input.modelVersion === undefined ||
      input.checkpointHashSha256 === undefined ||
      input.scoreName === undefined ||
      input.scoreDirection === undefined ||
      input.scoreDirection === ScoreDirection.NOT_APPLICABLE ||
      input.rawScore === undefined ||
      input.processingLatencyMs === undefined
    ) {
      invalid([
        'modelName',
        'modelVersion',
        'checkpointHashSha256',
        'scoreName',
        'scoreDirection',
        'rawScore',
        'processingLatencyMs',
      ]);
    }
    return;
  }
  const scoreFieldsPresent = [
    input.modelName,
    input.modelVersion,
    input.checkpointHashSha256,
    input.scoreName,
    input.scoreDirection,
    input.rawScore,
    input.calibratedScore,
    input.calibrationVersion,
  ].some((value) => value !== undefined);
  if (scoreFieldsPresent) invalid(['modelEvidence']);
  if (input.eventType === MlEvidenceEventType.INSUFFICIENT_EVIDENCE) {
    if (input.evidenceType !== EvidenceType.INSUFFICIENT_EVIDENCE || !input.reasonCodes?.length) {
      invalid(['evidenceType', 'reasonCodes']);
    }
  } else if (input.evidenceType !== EvidenceType.PIPELINE_ERROR || input.errorCode === undefined) {
    invalid(['evidenceType', 'errorCode']);
  }
}

@Injectable()
export class EvidenceIngestionService {
  constructor(
    private readonly calls: CallRepository,
    private readonly evidence: EvidenceRepository,
    private readonly riskDecision: RiskDecisionService,
    @Optional() private readonly headlessPipeline?: HeadlessRiskPipelineService,
    @Optional() private readonly securityOutbox?: SecurityEventOutboxService,
    @Optional() private readonly engineeringInterventions?: EngineeringInterventionExecutorService,
  ) {}

  async ingest(input: MlEvidenceDto) {
    assertSemantics(input);
    const context = { organizationId: input.organizationId };
    const grant = await this.calls.findAnalysisGrantContext(context, input.analysisSessionId);
    if (grant.call.id !== input.callId || grant.binding.id !== input.trackBindingId) {
      throw new ApiError(
        'ANALYSIS_BINDING_CONFLICT',
        'Evidence does not match the authorized media binding.',
        HttpStatus.CONFLICT,
      );
    }
    const sessionMode = grant.session.evidenceMode ?? EvidenceMode.SIMULATED;
    if (input.evidenceMode !== undefined && input.evidenceMode !== sessionMode) {
      throw new ApiError(
        'EVIDENCE_MODE_CONFLICT',
        'Evidence mode does not match the authorized analysis session.',
        HttpStatus.CONFLICT,
      );
    }
    const acceptanceStatus =
      terminalCalls.has(grant.call.status) || terminalSessions.has(grant.session.status)
        ? EvidenceAcceptanceStatus.STALE
        : EvidenceAcceptanceStatus.ACCEPTED;
    const readiness =
      input.eventType === MlEvidenceEventType.INSUFFICIENT_EVIDENCE
        ? EvidenceReadiness.INSUFFICIENT
        : input.eventType === MlEvidenceEventType.PIPELINE_ERROR
          ? EvidenceReadiness.ERROR
          : EvidenceReadiness.READY;
    const recordInput = {
      callId: input.callId,
      analysisSessionId: input.analysisSessionId,
      trackBindingId: input.trackBindingId,
      ...(input.modelVersionId === undefined ? {} : { modelVersionId: input.modelVersionId }),
      idempotencyKey: input.eventId,
      schemaVersion: input.schemaVersion,
      evidenceMode: sessionMode,
      eventSequence: BigInt(input.eventSequence),
      windowSequence: BigInt(input.windowSequence),
      revision: input.revision,
      evidenceType: input.evidenceType,
      readiness,
      acceptanceStatus,
      windowStartMs: BigInt(input.windowStartMs),
      windowEndMs: BigInt(input.windowEndMs),
      observedAt: new Date(input.observedAt),
      ...(input.processingLatencyMs === undefined
        ? {}
        : { processingLatencyMs: input.processingLatencyMs }),
      ...(input.speechDurationMs === undefined ? {} : { speechDurationMs: input.speechDurationMs }),
      ...(input.qualityScore === undefined ? {} : { qualityScore: input.qualityScore }),
      ...(input.reasonCodes === undefined ? {} : { reasonCodes: input.reasonCodes }),
      ...(input.modelName === undefined ? {} : { modelName: input.modelName }),
      ...(input.modelVersion === undefined ? {} : { modelVersion: input.modelVersion }),
      ...(input.checkpointHashSha256 === undefined
        ? {}
        : { checkpointHashSha256: input.checkpointHashSha256 }),
      ...(input.scoreName === undefined ? {} : { scoreName: input.scoreName }),
      ...(input.scoreDirection === undefined ? {} : { scoreDirection: input.scoreDirection }),
      ...(input.rawScore === undefined ? {} : { rawScore: input.rawScore }),
      ...(input.calibratedScore === undefined ? {} : { calibratedScore: input.calibratedScore }),
      ...(input.calibrationVersion === undefined
        ? {}
        : { calibrationVersion: input.calibrationVersion }),
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    };
    if (
      acceptanceStatus === EvidenceAcceptanceStatus.ACCEPTED &&
      this.headlessPipeline !== undefined &&
      typeof this.evidence.recordWithClient === 'function'
    ) {
      const processed = await this.headlessPipeline.ingestAcceptedEvidence({
        organizationId: input.organizationId,
        evidence: recordInput,
      });
      await Promise.allSettled([
        this.securityOutbox?.flush() ?? Promise.resolve(0),
        this.engineeringInterventions?.executePending() ?? Promise.resolve(0),
      ]);
      return {
        evidenceEventId: processed.evidenceEventId,
        eventId: input.eventId,
        acceptanceStatus: processed.acceptanceStatus,
        riskAssessment: processed.riskAssessment,
      };
    }
    const event = await this.evidence.record(context, recordInput);
    const riskAssessment =
      event.acceptanceStatus === EvidenceAcceptanceStatus.ACCEPTED
        ? await this.riskDecision.assessAcceptedEvidence({
            organizationId: input.organizationId,
            analysisSessionId: input.analysisSessionId,
            triggerEvidenceEventId: event.id,
          })
        : {
            assessmentStatus: 'SUPPRESSED' as const,
            productionEligible: false,
            reasonCode: 'EVIDENCE_NOT_ACCEPTED_FOR_RISK',
          };
    return {
      evidenceEventId: event.id,
      eventId: input.eventId,
      acceptanceStatus: event.acceptanceStatus,
      riskAssessment,
    };
  }
}
