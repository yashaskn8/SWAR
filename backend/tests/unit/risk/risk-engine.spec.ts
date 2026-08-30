import { describe, expect, it } from 'vitest';

import { ConfigurationService } from '../../../src/config/configuration';
import {
  EvidenceMode,
  EvidenceReadiness,
  EvidenceType,
  InterventionType,
  ModelLifecycleStatus,
  RiskAssessmentOutcome,
  RiskDecisionMode,
  RiskState,
  ScoreDirection,
  ScoreTarget,
} from '../../../src/generated/prisma/client';
import { RiskActivationGateService } from '../../../src/modules/risk/risk-activation-gate.service';
import {
  evaluateRiskEvidence,
  type RiskEngineEvidence,
} from '../../../src/modules/risk/risk-engine';
import {
  parseRiskPolicyDocument,
  RiskPolicyValidationError,
  type RiskPolicyDocumentV1,
} from '../../../src/modules/risk/risk-policy';
import { validTestEnvironment } from '../../test-environment';

const policy: RiskPolicyDocumentV1 = {
  schemaVersion: '1.0.0',
  activationMode: 'ENGINEERING_ONLY',
  thresholdClassification: 'ENGINEERING_FIXTURE_NOT_CALIBRATED',
  thresholdVersion: 'engineering-fixture-thresholds-v1-not-calibrated',
  calibrationVersion: null,
  quality: {
    minimumScore: 0.5,
    minimumSpeechDurationMs: 1_000,
    rejectingReasonCodes: ['SEVERE_CLIPPING', 'DISCONTINUITY'],
  },
  thresholds: {
    identityEnter: 0.7,
    identityClear: 0.6,
    spoofEnter: 0.7,
    spoofClear: 0.6,
  },
  fusion: { fastWeight: 0.2, deepWeight: 0.8 },
  hysteresis: {
    entryConsecutiveWindows: 2,
    clearConsecutiveWindows: 3,
    maximumWindowGap: 0,
  },
  interventions: {
    highRisk: [InterventionType.WARN],
    critical: [
      InterventionType.WARN,
      InterventionType.HOLD_PROTECTED_ACTION,
      InterventionType.REQUIRE_STEP_UP,
    ],
  },
};

function evidence(input: {
  id: string;
  window: number;
  type: EvidenceType;
  score: number;
  target: ScoreTarget;
  revision?: number;
}): RiskEngineEvidence {
  return {
    id: input.id,
    evidenceMode: EvidenceMode.SIMULATED,
    evidenceType: input.type,
    readiness: EvidenceReadiness.READY,
    windowSequence: BigInt(input.window),
    eventSequence: BigInt(input.window * 10 + (input.type === EvidenceType.IDENTITY ? 1 : 2)),
    revision: input.revision ?? 0,
    observedAt: new Date(`2030-01-01T00:00:0${input.window}Z`),
    qualityScore: 0.9,
    speechDurationMs: 3_000,
    reasonCodes: [],
    rawScore: input.score,
    calibratedScore: null,
    calibrationVersion: null,
    scoreDirection: ScoreDirection.HIGHER_MEANS_MORE,
    scoreTarget: input.target,
    modelStatus: ModelLifecycleStatus.REJECTED,
    modelTraceMatches: true,
  };
}

function scenario(identityScore: number, spoofScore: number): RiskEngineEvidence[] {
  return [1, 2].flatMap((window) => [
    evidence({
      id: `identity-${window}`,
      window,
      type: EvidenceType.IDENTITY,
      score: identityScore,
      target: ScoreTarget.EXPECTED_SPEAKER,
    }),
    evidence({
      id: `spoof-${window}`,
      window,
      type: EvidenceType.SPOOF_FAST,
      score: spoofScore,
      target: ScoreTarget.SPOOF,
    }),
  ]);
}

describe('Phase Q engineering risk engine', () => {
  it('accepts the strict engineering policy and rejects partial production promotion', () => {
    expect(parseRiskPolicyDocument(policy)).toEqual(policy);
    expect(() => parseRiskPolicyDocument({ ...policy, activationMode: 'PRODUCTION' })).toThrow(
      RiskPolicyValidationError,
    );
    expect(() => parseRiskPolicyDocument({ ...policy, unexpected: true })).toThrow(
      RiskPolicyValidationError,
    );
  });
  it.each([
    [0.9, 0.1, RiskState.VERIFIED],
    [0.1, 0.1, RiskState.UNVERIFIED],
    [0.1, 0.9, RiskState.HIGH_RISK],
    [0.9, 0.9, RiskState.CRITICAL],
  ])('maps identity=%s spoof=%s to %s after persistence', (identity, spoof, state) => {
    const result = evaluateRiskEvidence(scenario(identity, spoof), policy);
    expect(result.outcome).toBe(state);
    expect(result.effectiveState).toBe(state);
    expect(result.proposedInterventions).toEqual(
      state === RiskState.CRITICAL
        ? policy.interventions.critical
        : state === RiskState.HIGH_RISK
          ? policy.interventions.highRisk
          : [],
    );
  });

  it('treats exact boundaries deterministically and applies hysteresis before a transition', () => {
    const oneWindow = scenario(0.7, 0.7).filter(({ windowSequence }) => windowSequence === 1n);
    const pending = evaluateRiskEvidence(oneWindow, policy);
    expect(pending.outcome).toBe(RiskAssessmentOutcome.CRITICAL);
    expect(pending.effectiveState).toBe(RiskState.UNVERIFIED);
    expect(pending.reasonCode).toBe('HYSTERESIS_PENDING');
    expect(evaluateRiskEvidence(scenario(0.7, 0.7), policy).effectiveState).toBe(
      RiskState.CRITICAL,
    );
  });

  it('returns insufficient evidence for poor audio without entering a risk state', () => {
    const poor = scenario(0.9, 0.9);
    poor.at(-1)!.qualityScore = 0.1;
    const result = evaluateRiskEvidence(poor, policy);
    expect(result.outcome).toBe(RiskAssessmentOutcome.INSUFFICIENT_EVIDENCE);
    expect(result.reasonCode).toBe('AUDIO_QUALITY_GATE_FAILED');
    expect(result.proposedInterventions).toEqual([]);
  });

  it('fuses delayed DEEP evidence for the same windows without double-counting revisions', () => {
    const fastOnly = scenario(0.9, 0.1);
    expect(evaluateRiskEvidence(fastOnly, policy).effectiveState).toBe(RiskState.VERIFIED);
    const withDeep = [
      ...fastOnly,
      ...[1, 2].map((window) =>
        evidence({
          id: `deep-${window}`,
          window,
          type: EvidenceType.SPOOF_DEEP,
          score: 1,
          target: ScoreTarget.SPOOF,
          revision: 1,
        }),
      ),
    ];
    expect(evaluateRiskEvidence(withDeep, policy).effectiveState).toBe(RiskState.CRITICAL);
  });

  it('uses the newest semantic revision even when replacement evidence arrives out of order', () => {
    const original = scenario(0.9, 0.9);
    const replacements = [1, 2].map((window) =>
      evidence({
        id: `spoof-revision-${window}`,
        window,
        type: EvidenceType.SPOOF_FAST,
        score: 0.1,
        target: ScoreTarget.SPOOF,
        revision: 1,
      }),
    );
    const outOfOrder = [replacements[1]!, ...original.toReversed(), replacements[0]!];
    expect(evaluateRiskEvidence(outOfOrder, policy).effectiveState).toBe(RiskState.VERIFIED);
  });

  it('requires clear hysteresis and resets pending transitions across a missing-window gap', () => {
    const criticalThenClearing = [
      ...scenario(0.9, 0.9),
      ...[3, 4, 5].flatMap((window) => [
        evidence({
          id: `identity-clear-${window}`,
          window,
          type: EvidenceType.IDENTITY,
          score: 0.9,
          target: ScoreTarget.EXPECTED_SPEAKER,
        }),
        evidence({
          id: `spoof-clear-${window}`,
          window,
          type: EvidenceType.SPOOF_FAST,
          score: 0.1,
          target: ScoreTarget.SPOOF,
        }),
      ]),
    ];
    expect(evaluateRiskEvidence(criticalThenClearing.slice(0, -2), policy).effectiveState).toBe(
      RiskState.CRITICAL,
    );
    expect(evaluateRiskEvidence(criticalThenClearing, policy).effectiveState).toBe(
      RiskState.VERIFIED,
    );

    const missingWindow = scenario(0.9, 0.9).map((item) =>
      item.windowSequence === 2n ? { ...item, windowSequence: 3n, id: `${item.id}-late` } : item,
    );
    expect(evaluateRiskEvidence(missingWindow, policy)).toMatchObject({
      outcome: RiskAssessmentOutcome.CRITICAL,
      effectiveState: RiskState.UNVERIFIED,
      reasonCode: 'HYSTERESIS_PENDING',
    });
  });

  it('normalizes explicit score target and direction before the matrix', () => {
    const inverseSemantics = scenario(0.1, 0.1);
    for (const item of inverseSemantics) {
      item.scoreDirection = ScoreDirection.LOWER_MEANS_MORE;
      if (item.evidenceType === EvidenceType.SPOOF_FAST) item.scoreTarget = ScoreTarget.BONAFIDE;
    }
    expect(evaluateRiskEvidence(inverseSemantics, policy).effectiveState).toBe(RiskState.VERIFIED);
  });

  it('is deterministic for duplicate-free arrival permutations and missing DEEP evidence', () => {
    const ordered = scenario(0.1, 0.9);
    const reordered = [ordered[3]!, ordered[0]!, ordered[2]!, ordered[1]!];
    expect(evaluateRiskEvidence(reordered, policy)).toMatchObject(
      evaluateRiskEvidence(ordered, policy),
    );
  });

  it.each([EvidenceMode.SIMULATED, EvidenceMode.SHADOW, EvidenceMode.CALIBRATED])(
    'suppresses %s evidence while Phase O/P/Q promotion gates are blocked',
    (evidenceMode) => {
      const gate = new RiskActivationGateService(new ConfigurationService(validTestEnvironment()));
      const decision = gate.evaluate(policy, {
        evidenceMode,
        sufficientEvidence: true,
        allScoresCalibrated: evidenceMode === EvidenceMode.CALIBRATED,
        calibrationVersions: new Set(['fixture-calibration']),
        allModelsActiveAndTraceable: true,
      });
      expect(decision.productionEligible).toBe(false);
      expect(decision.activationSuppressed).toBe(true);
      expect(decision.decisionMode).toBe(
        evidenceMode === EvidenceMode.SIMULATED
          ? RiskDecisionMode.ENGINEERING_TEST
          : evidenceMode === EvidenceMode.SHADOW
            ? RiskDecisionMode.SHADOW
            : RiskDecisionMode.CALIBRATED_BLOCKED,
      );
      expect(decision.blockerCodes).toContain('PHASE_O_SCIENTIFIC_CALIBRATION_BLOCKED');
      expect(decision.blockerCodes).toContain('PHASE_P_NOT_PRODUCTION_PROMOTED');
      expect(decision.blockerCodes).toContain('PHASE_Q_ENGINEERING_ONLY');
    },
  );

  it('suppresses production eligibility for insufficient evidence independently of promotion', () => {
    const gate = new RiskActivationGateService(new ConfigurationService(validTestEnvironment()));
    const decision = gate.evaluate(policy, {
      evidenceMode: EvidenceMode.CALIBRATED,
      sufficientEvidence: false,
      allScoresCalibrated: true,
      calibrationVersions: new Set(['fixture-calibration']),
      allModelsActiveAndTraceable: true,
    });
    expect(decision.productionEligible).toBe(false);
    expect(decision.blockerCodes).toContain('INSUFFICIENT_EVIDENCE');
  });
});
