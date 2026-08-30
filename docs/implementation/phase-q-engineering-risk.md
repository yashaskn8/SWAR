# Phase Q engineering-only risk and intervention architecture

Status: `IMPLEMENTED_NOT_PROMOTED`

Production activation: `BLOCKED_BY_PHASE_O_AND_PHASE_P`

Phase R: `LOCKED`

## Authorized dependency exception

CONTRACT CONSISTENCY ISSUE
The frozen Phase Q dependency gate requires promoted Phase O calibration and production-promoted Phase P serving, but Phase O remains scientifically blocked and Phase P is implemented but not promoted.

WHY IT MATTERS
Treating raw, simulated, fixture, shadow, or unpromoted calibrated-looking values as production evidence could create false warnings or holds and would violate the no-bluff and risk-responsibility contracts.

MINIMAL CORRECTION
Implement Phase Q architecture in engineering/test/shadow mode only, persist explicitly suppressed assessments, keep production transition/intervention/event delivery fail-closed, and keep Phase R locked. The user authorized this limited correction on 2026-08-30.

## Implemented engineering path

Authenticated, tenant- and track-bound evidence remains owned by the Phase P ingestion boundary. For each accepted evidence set, NestJS now:

1. loads the call-frozen policy and accepted session evidence under `organizationId`;
2. selects the newest semantic revision per window and evidence type;
3. verifies registered model/checkpoint/score metadata and explicit score target/direction;
4. applies speech-duration, quality-score, and rejecting-reason gates;
5. normalizes bounded fixture/calibrated score direction toward expected-speaker or spoof evidence;
6. combines FAST and delayed DEEP evidence for the same window without double-counting;
7. recomputes windows in semantic order, with entry/clearing hysteresis and deterministic gap handling;
8. produces `VERIFIED`, `UNVERIFIED`, `HIGH_RISK`, `CRITICAL`, or internal `INSUFFICIENT_EVIDENCE`;
9. records one immutable, idempotent `RiskAssessment` plus exact evidence links and allow-listed audit metadata; and
10. returns the assessment mode and production-suppression result with evidence acceptance.

`SIMULATED`, `SHADOW`, and calibrated-looking evidence while the promotion chain is blocked can record only `ENGINEERING_TEST`, `SHADOW`, or `CALIBRATED_BLOCKED` assessments. Proposed intervention enums are architecture/test intent only. They do not create a `RiskEvent`, `Intervention`, `Alert`, WebSocket security event, warning, hold, block, escalation, or end-call action.

## Fail-closed production gate

Production transition persistence is guarded again at the repository boundary. It requires all of the following:

- `RISK_INTERVENTION_MODE=PRODUCTION`;
- `PHASE_O_SCIENTIFIC_STATUS=PROMOTED`;
- `PHASE_P_PRODUCTION_STATUS=PROMOTED`;
- `PHASE_Q_PRODUCTION_STATUS=PROMOTED`;
- a strict risk policy with `activationMode=PRODUCTION`, `PROMOTED_CALIBRATION`, and a non-null calibration version;
- `CALIBRATED` accepted evidence with calibrated scores from exactly one matching calibration version; and
- active registered models whose name, version, checkpoint hash, score name/direction, and score target match the evidence snapshot.

Current committed configuration declares Phase O `BLOCKED`, Phase P `BLOCKED_BY_PHASE_O`, and Phase Q `ENGINEERING_ONLY`. Production-mode configuration is rejected at startup if those statuses are not all promoted. The Phase Q decision service intentionally does not invoke production transition/action/event delivery in this engineering-only build.

## Contracts and persistence

- `risk-policy.v1.json` strictly defines quality, bounded score, fusion, hysteresis, intervention-intent, threshold-classification, and activation fields.
- `risk-policy.engineering-fixture.v1.json` is labelled `ENGINEERING_FIXTURE_NOT_CALIBRATED`; its numeric values are test inputs, not scientific thresholds or performance claims.
- `ScoreTarget` records whether a model score is about the expected speaker, spoof, bona fide speech, or audio quality; existing records remain nullable and cannot be production eligible without it.
- `RiskAssessment` and `RiskAssessmentEvidence` persist minimal decisions and provenance without raw audio, embeddings, tensors, call content, tokens, or checkpoint bytes.
- `GET /api/v1/calls/{callId}/risk-assessments` uses the existing JWT/RBAC/tenant checks and exposes suppression/eligibility explicitly. Existing `/ws/security` authentication, call authorization, replay bounds, and tenant filtering are unchanged; suppressed assessments are not published there.

## Production-dependent work deliberately blocked

The following Phase Q portion is not claimed complete: creating production `RiskEvent` transitions, transactional warning/hold/step-up records, external hold activation, and authenticated WebSocket delivery from live calibrated evidence. That work must be wired and tested only after genuine Phase O promotion, Phase P production promotion, approved Phase Q policy/threshold review, and an explicit Phase Q production activation decision.

Phase R remains locked. Engineering Phase Q does not satisfy the backend-completion gate.
