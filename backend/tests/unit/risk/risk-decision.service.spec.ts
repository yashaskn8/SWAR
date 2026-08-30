import { describe, expect, it, vi } from 'vitest';

import { ConfigurationService } from '../../../src/config/configuration';
import {
  EvidenceAcceptanceStatus,
  EvidenceMode,
  EvidenceReadiness,
  EvidenceType,
  ModelLifecycleStatus,
  RiskAssessmentOutcome,
  ScoreDirection,
  ScoreTarget,
} from '../../../src/generated/prisma/client';
import type { AuditService } from '../../../src/modules/audit/audit.service';
import { RiskActivationGateService } from '../../../src/modules/risk/risk-activation-gate.service';
import { RiskDecisionService } from '../../../src/modules/risk/risk-decision.service';
import type {
  RecordRiskAssessmentInput,
  RiskRepository,
} from '../../../src/modules/risk/risk.repository';
import { validTestEnvironment } from '../../test-environment';

const organizationId = '018f0000-0000-7000-8000-000000000001';
const callId = '018f0000-0000-7000-8000-000000000002';
const sessionId = '018f0000-0000-7000-8000-000000000003';
const policyId = '018f0000-0000-7000-8000-000000000004';

const policyDocument = {
  schemaVersion: '1.0.0',
  activationMode: 'ENGINEERING_ONLY',
  thresholdClassification: 'ENGINEERING_FIXTURE_NOT_CALIBRATED',
  thresholdVersion: 'engineering-fixture-not-calibrated',
  calibrationVersion: null,
  quality: { minimumScore: 0.5, minimumSpeechDurationMs: 1_000, rejectingReasonCodes: [] },
  thresholds: { identityEnter: 0.7, identityClear: 0.6, spoofEnter: 0.7, spoofClear: 0.6 },
  fusion: { fastWeight: 0.5, deepWeight: 0.5 },
  hysteresis: { entryConsecutiveWindows: 2, clearConsecutiveWindows: 3, maximumWindowGap: 0 },
  interventions: {
    highRisk: ['WARN'],
    critical: ['WARN', 'HOLD_PROTECTED_ACTION', 'REQUIRE_STEP_UP'],
  },
};

function event(window: number, type: EvidenceType, score: number, target: ScoreTarget) {
  const id = `018f0000-0000-7000-8000-${String(window * 10 + (type === EvidenceType.IDENTITY ? 1 : 2)).padStart(12, '0')}`;
  const modelId = `018f0000-0000-7000-8001-${String(window * 10 + (type === EvidenceType.IDENTITY ? 1 : 2)).padStart(12, '0')}`;
  const modelName = type === EvidenceType.IDENTITY ? 'FIXTURE_IDENTITY' : 'FIXTURE_SPOOF';
  const modelVersionRef = {
    id: modelId,
    modelName,
    version: 'fixture-v1',
    checkpointHashSha256: 'a'.repeat(64),
    scoreName: 'fixture_score',
    scoreDirection: ScoreDirection.HIGHER_MEANS_MORE,
    scoreTarget: target,
    status: ModelLifecycleStatus.REJECTED,
  };
  return {
    id,
    organizationId,
    callId,
    analysisSessionId: sessionId,
    trackBindingId: '018f0000-0000-7000-8000-000000000005',
    modelVersionId: modelId,
    idempotencyKey: id,
    schemaVersion: '1.1.0',
    evidenceMode: EvidenceMode.SIMULATED,
    eventSequence: BigInt(window * 10 + (type === EvidenceType.IDENTITY ? 1 : 2)),
    windowSequence: BigInt(window),
    revision: 0,
    evidenceType: type,
    readiness: EvidenceReadiness.READY,
    acceptanceStatus: EvidenceAcceptanceStatus.ACCEPTED,
    windowStartMs: BigInt((window - 1) * 1_000),
    windowEndMs: BigInt((window - 1) * 1_000 + 4_000),
    observedAt: new Date(`2030-01-01T00:00:0${window}Z`),
    receivedAt: new Date(`2030-01-01T00:00:0${window}Z`),
    processingLatencyMs: 1,
    speechDurationMs: 3_000,
    qualityScore: 0.9,
    reasonCodes: ['SIMULATED_NON_SCIENTIFIC_EVIDENCE'],
    modelName,
    modelVersion: 'fixture-v1',
    checkpointHashSha256: 'a'.repeat(64),
    scoreName: 'fixture_score',
    scoreDirection: ScoreDirection.HIGHER_MEANS_MORE,
    rawScore: score,
    calibratedScore: null,
    calibrationVersion: null,
    errorCode: null,
    supersedesEvidenceId: null,
    createdAt: new Date(`2030-01-01T00:00:0${window}Z`),
    modelVersionRef,
  };
}

describe('Phase Q decision orchestration', () => {
  it('persists a suppressed CRITICAL assessment without creating a production control', async () => {
    const evidenceEvents = [1, 2].flatMap((window) => [
      event(window, EvidenceType.IDENTITY, 0.9, ScoreTarget.EXPECTED_SPEAKER),
      event(window, EvidenceType.SPOOF_FAST, 0.9, ScoreTarget.SPOOF),
    ]);
    let latestAssessment:
      | (Omit<RecordRiskAssessmentInput, 'calibrationVersion'> & {
          id: string;
          calibrationVersion: string | null;
          evidenceLinks: never[];
        })
      | null = null;
    const recordAssessment = vi.fn((_context: unknown, input: RecordRiskAssessmentInput) => {
      latestAssessment ??= {
        id: '018f0000-0000-7000-8000-000000000099',
        ...input,
        calibrationVersion: input.calibrationVersion ?? null,
        evidenceLinks: [],
      };
      return Promise.resolve(latestAssessment);
    });
    const repository = {
      loadDecisionContext: vi.fn().mockResolvedValue({
        id: sessionId,
        organizationId,
        callId,
        evidenceMode: EvidenceMode.SIMULATED,
        call: {
          id: callId,
          riskPolicyId: policyId,
          riskPolicyVersion: 'engineering-v1',
          riskPolicy: {
            id: policyId,
            policyKey: 'default',
            version: 'engineering-v1',
            policyDocument,
          },
        },
        evidenceEvents,
      }),
      findLatestAssessment: vi.fn(() => Promise.resolve(latestAssessment)),
      recordAssessment,
    } as unknown as RiskRepository;
    const service = new RiskDecisionService(
      repository,
      new RiskActivationGateService(new ConfigurationService(validTestEnvironment())),
      { record: vi.fn() } as unknown as AuditService,
    );
    const request = {
      organizationId,
      analysisSessionId: sessionId,
      triggerEvidenceEventId: evidenceEvents.at(-1)!.id,
    };
    await expect(service.assessAcceptedEvidence(request)).resolves.toMatchObject({
      outcome: RiskAssessmentOutcome.CRITICAL,
      productionEligible: false,
      activationSuppressed: true,
      reasonCode: 'ENGINEERING_ONLY_MODE',
    });
    await expect(service.assessAcceptedEvidence(request)).resolves.toMatchObject({
      riskAssessmentId: '018f0000-0000-7000-8000-000000000099',
      activationSuppressed: true,
    });
    expect(recordAssessment).toHaveBeenCalledWith(
      { organizationId },
      expect.objectContaining({
        productionEligible: false,
        activationSuppressed: true,
        proposedInterventions: ['WARN', 'HOLD_PROTECTED_ACTION', 'REQUIRE_STEP_UP'],
      }),
    );
    const firstInput = recordAssessment.mock.calls[0]![1];
    const replayInput = recordAssessment.mock.calls[1]![1];
    expect(replayInput).toMatchObject({
      idempotencyKey: firstInput.idempotencyKey,
      priorState: firstInput.priorState,
      transitioned: firstInput.transitioned,
    });
    expect(repository).not.toHaveProperty('recordTransition');
  });
});
