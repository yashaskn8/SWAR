import {
  EvidenceMode,
  EvidenceReadiness,
  EvidenceType,
  InterventionType,
  ModelLifecycleStatus,
  RiskAssessmentOutcome,
  RiskState,
  ScoreDirection,
  ScoreTarget,
} from '../../generated/prisma/client';
import type { RiskPolicyDocumentV1 } from './risk-policy';

export interface RiskEngineEvidence {
  id: string;
  evidenceMode: EvidenceMode;
  evidenceType: EvidenceType;
  readiness: EvidenceReadiness;
  windowSequence: bigint;
  eventSequence: bigint;
  revision: number;
  observedAt: Date;
  qualityScore: number | null;
  speechDurationMs: number | null;
  reasonCodes: string[];
  rawScore: number | null;
  calibratedScore: number | null;
  calibrationVersion: string | null;
  scoreDirection: ScoreDirection;
  scoreTarget: ScoreTarget | null;
  modelStatus: ModelLifecycleStatus | null;
  modelTraceMatches: boolean;
}

export interface RiskEngineResult {
  outcome: RiskAssessmentOutcome;
  effectiveState: RiskState;
  reasonCode: string;
  proposedInterventions: InterventionType[];
  evidenceEventIds: string[];
  maxWindowSequence: bigint;
  occurredAt: Date;
  allScoresCalibrated: boolean;
  calibrationVersions: Set<string>;
  allModelsActiveAndTraceable: boolean;
}

interface WindowDecision {
  outcome: RiskAssessmentOutcome;
  state: RiskState | null;
  reasonCode: string;
  sequence: bigint;
  observedAt: Date;
}

const stateSeverity: Record<RiskState, number> = {
  [RiskState.VERIFIED]: 0,
  [RiskState.UNVERIFIED]: 1,
  [RiskState.HIGH_RISK]: 2,
  [RiskState.CRITICAL]: 3,
};

function selectLatest(events: RiskEngineEvidence[]): RiskEngineEvidence[] {
  const latest = new Map<string, RiskEngineEvidence>();
  for (const event of events) {
    const key = `${event.windowSequence}:${event.evidenceType}`;
    const current = latest.get(key);
    if (
      current === undefined ||
      event.revision > current.revision ||
      (event.revision === current.revision && event.eventSequence > current.eventSequence)
    ) {
      latest.set(key, event);
    }
  }
  return [...latest.values()].sort((left, right) => {
    if (left.windowSequence !== right.windowSequence) {
      return left.windowSequence < right.windowSequence ? -1 : 1;
    }
    if (left.evidenceType !== right.evidenceType) {
      return left.evidenceType.localeCompare(right.evidenceType);
    }
    return left.revision - right.revision;
  });
}

function targetScore(event: RiskEngineEvidence, desired: ScoreTarget): number | null {
  const score = event.calibratedScore ?? event.rawScore;
  if (score === null || score < 0 || score > 1 || event.scoreTarget === null) return null;
  const moreOfRecordedTarget =
    event.scoreDirection === ScoreDirection.HIGHER_MEANS_MORE
      ? score
      : event.scoreDirection === ScoreDirection.LOWER_MEANS_MORE
        ? 1 - score
        : null;
  if (moreOfRecordedTarget === null) return null;
  if (event.scoreTarget === desired) return moreOfRecordedTarget;
  if (
    (event.scoreTarget === ScoreTarget.BONAFIDE && desired === ScoreTarget.SPOOF) ||
    (event.scoreTarget === ScoreTarget.SPOOF && desired === ScoreTarget.BONAFIDE)
  ) {
    return 1 - moreOfRecordedTarget;
  }
  return null;
}

function insufficient(sequence: bigint, observedAt: Date, reasonCode: string): WindowDecision {
  return {
    outcome: RiskAssessmentOutcome.INSUFFICIENT_EVIDENCE,
    state: null,
    reasonCode,
    sequence,
    observedAt,
  };
}

function evaluateWindow(
  events: RiskEngineEvidence[],
  policy: RiskPolicyDocumentV1,
  currentState: RiskState,
): WindowDecision {
  const first = events[0]!;
  const explicitInsufficient = events.find(
    ({ evidenceType }) => evidenceType === EvidenceType.INSUFFICIENT_EVIDENCE,
  );
  if (explicitInsufficient !== undefined) {
    return insufficient(
      first.windowSequence,
      explicitInsufficient.observedAt,
      'AUDIO_INSUFFICIENT',
    );
  }
  if (events.some(({ evidenceType }) => evidenceType === EvidenceType.PIPELINE_ERROR)) {
    return insufficient(first.windowSequence, first.observedAt, 'PIPELINE_DEGRADED');
  }
  const identity = events.find(({ evidenceType }) => evidenceType === EvidenceType.IDENTITY);
  const fast = events.find(({ evidenceType }) => evidenceType === EvidenceType.SPOOF_FAST);
  const deep = events.find(({ evidenceType }) => evidenceType === EvidenceType.SPOOF_DEEP);
  if (identity === undefined || (fast === undefined && deep === undefined)) {
    return insufficient(first.windowSequence, first.observedAt, 'EVIDENCE_COMPONENT_MISSING');
  }
  const scored = [
    identity,
    ...(fast === undefined ? [] : [fast]),
    ...(deep === undefined ? [] : [deep]),
  ];
  if (scored.some(({ readiness }) => readiness !== EvidenceReadiness.READY)) {
    return insufficient(first.windowSequence, first.observedAt, 'MODEL_NOT_READY');
  }
  const qualityScores = scored.map(({ qualityScore }) => qualityScore);
  const speechDurations = scored.map(({ speechDurationMs }) => speechDurationMs);
  if (
    qualityScores.some((value) => value === null || value < policy.quality.minimumScore) ||
    speechDurations.some(
      (value) => value === null || value < policy.quality.minimumSpeechDurationMs,
    ) ||
    scored.some(({ reasonCodes }) =>
      reasonCodes.some((code) => policy.quality.rejectingReasonCodes.includes(code)),
    )
  ) {
    return insufficient(first.windowSequence, first.observedAt, 'AUDIO_QUALITY_GATE_FAILED');
  }
  const identityScore = targetScore(identity, ScoreTarget.EXPECTED_SPEAKER);
  const fastScore = fast === undefined ? null : targetScore(fast, ScoreTarget.SPOOF);
  const deepScore = deep === undefined ? null : targetScore(deep, ScoreTarget.SPOOF);
  if (identityScore === null || (fastScore === null && deepScore === null)) {
    return insufficient(first.windowSequence, first.observedAt, 'SCORE_SEMANTICS_UNUSABLE');
  }
  const spoofScore =
    fastScore !== null && deepScore !== null
      ? fastScore * policy.fusion.fastWeight + deepScore * policy.fusion.deepWeight
      : (fastScore ?? deepScore)!;
  const identityThreshold =
    currentState === RiskState.VERIFIED || currentState === RiskState.CRITICAL
      ? policy.thresholds.identityClear
      : policy.thresholds.identityEnter;
  const spoofThreshold =
    currentState === RiskState.HIGH_RISK || currentState === RiskState.CRITICAL
      ? policy.thresholds.spoofClear
      : policy.thresholds.spoofEnter;
  const identityHigh = identityScore >= identityThreshold;
  const spoofHigh = spoofScore >= spoofThreshold;
  const state = identityHigh
    ? spoofHigh
      ? RiskState.CRITICAL
      : RiskState.VERIFIED
    : spoofHigh
      ? RiskState.HIGH_RISK
      : RiskState.UNVERIFIED;
  return {
    outcome: state,
    state,
    reasonCode: `MATRIX_${state}`,
    sequence: first.windowSequence,
    observedAt: new Date(Math.max(...scored.map(({ observedAt }) => observedAt.getTime()))),
  };
}

export function evaluateRiskEvidence(
  evidence: RiskEngineEvidence[],
  policy: RiskPolicyDocumentV1,
): RiskEngineResult {
  const selected = selectLatest(evidence);
  if (selected.length === 0) throw new Error('Accepted risk evidence is required.');
  const byWindow = new Map<bigint, RiskEngineEvidence[]>();
  for (const event of selected) {
    const group = byWindow.get(event.windowSequence) ?? [];
    group.push(event);
    byWindow.set(event.windowSequence, group);
  }
  let effectiveState: RiskState = RiskState.UNVERIFIED;
  let pendingState: RiskState | null = null;
  let pendingCount = 0;
  let previousValidSequence: bigint | null = null;
  let lastDecision = insufficient(0n, selected[0]!.observedAt, 'EVIDENCE_COMPONENT_MISSING');
  for (const [sequence, windowEvents] of [...byWindow.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const decision = evaluateWindow(windowEvents, policy, effectiveState);
    lastDecision = decision;
    if (decision.state === null) {
      pendingState = null;
      pendingCount = 0;
      continue;
    }
    if (decision.state === effectiveState) {
      pendingState = null;
      pendingCount = 0;
      previousValidSequence = sequence;
      continue;
    }
    const gap = previousValidSequence === null ? 1n : sequence - previousValidSequence;
    const contiguous = gap > 0n && gap <= BigInt(policy.hysteresis.maximumWindowGap + 1);
    pendingCount = pendingState === decision.state && contiguous ? pendingCount + 1 : 1;
    pendingState = decision.state;
    previousValidSequence = sequence;
    const clearing =
      (effectiveState === RiskState.HIGH_RISK || effectiveState === RiskState.CRITICAL) &&
      stateSeverity[decision.state] < stateSeverity[effectiveState];
    const required = clearing
      ? policy.hysteresis.clearConsecutiveWindows
      : policy.hysteresis.entryConsecutiveWindows;
    if (pendingCount >= required) {
      effectiveState = decision.state;
      pendingState = null;
      pendingCount = 0;
    }
  }
  const outcome = lastDecision.outcome;
  const proposedInterventions =
    effectiveState === RiskState.CRITICAL
      ? policy.interventions.critical
      : effectiveState === RiskState.HIGH_RISK
        ? policy.interventions.highRisk
        : [];
  const scored = selected.filter(({ readiness }) => readiness === EvidenceReadiness.READY);
  return {
    outcome,
    effectiveState,
    reasonCode:
      lastDecision.state !== null && lastDecision.state !== effectiveState
        ? 'HYSTERESIS_PENDING'
        : lastDecision.reasonCode,
    proposedInterventions,
    evidenceEventIds: selected.map(({ id }) => id),
    maxWindowSequence: selected.at(-1)!.windowSequence,
    occurredAt: new Date(Math.max(...selected.map(({ observedAt }) => observedAt.getTime()))),
    allScoresCalibrated:
      scored.length > 0 &&
      scored.every(
        ({ evidenceMode, calibratedScore, calibrationVersion }) =>
          evidenceMode === EvidenceMode.CALIBRATED &&
          calibratedScore !== null &&
          calibrationVersion !== null,
      ),
    calibrationVersions: new Set(
      scored.flatMap(({ calibrationVersion }) =>
        calibrationVersion === null ? [] : [calibrationVersion],
      ),
    ),
    allModelsActiveAndTraceable:
      scored.length > 0 &&
      scored.every(
        ({ modelStatus, modelTraceMatches, scoreTarget }) =>
          modelStatus === ModelLifecycleStatus.ACTIVE && modelTraceMatches && scoreTarget !== null,
      ),
  };
}
