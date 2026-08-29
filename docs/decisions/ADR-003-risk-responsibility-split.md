# ADR-003: Separate ML Evidence from Backend Risk and Action

Status: Accepted  
Date: 2026-08-28  
Decision owners: SWAR backend, ML, and security architecture  
Requirements: FR-ID-001 through FR-ID-004; FR-SPOOF-001 through FR-SPOOF-004; FR-RISK-001 through FR-RISK-006; FR-INT-001 through FR-INT-004; MLR-CAL-001

## Context

ECAPA, RawNet2, and AASIST answer technical questions with uncertain, model-specific scores. Protected-action decisions also require tenant policy, evidence history, hysteresis, user/workflow context, authorization, idempotency, and audit. Putting both concerns in one service would duplicate policy, leak database/business access into ML, and make calibration depend on transaction context.

## Decision

The FastAPI/PyTorch service owns:

- authorized-track transient preprocessing and quality;
- ECAPA identity similarity;
- RawNet2 FAST and AASIST DEEP spoof evidence;
- verified score semantics, model-level calibration, uncertainty, readiness/errors, and evidence revisions.

NestJS owns:

- authenticated evidence ingestion and revision/idempotency validation;
- temporal aggregation, persistence, hysteresis, threshold/policy versioning;
- the four user-facing risk states;
- protected-action context, warnings, holds, step-up, security events, and audit.

Transaction context may change the required action but cannot rewrite a model probability. Frontends display authorized state and never compute trusted risk locally.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| ML service emits final risk/action state | It would need business context, authorization, persistence, and policy and would violate service ownership. |
| NestJS interprets raw logits directly | Raw score semantics/calibration belong with versioned model adapters and can vary by checkpoint. |
| Frontend fuses evidence locally | Modified clients and divergent implementations could change protected decisions. |
| AASIST always overrides RawNet2 | Deep evidence is complementary and may be late, missing, or disagree; deterministic revision policy is required. |

## Consequences and trade-offs

- Positive: model science and business policy can be evaluated/versioned independently.
- Positive: ML requires no end-user authentication, PostgreSQL, or transaction privilege.
- Positive: backend recovery/audit can reconstruct decisions from compact evidence.
- Cost: typed versioned internal evidence contracts and deterministic late-revision handling are mandatory.
- Cost: both services must expose readiness/degraded behavior without inventing benign scores.
- Student feasibility: logical model slots and one private ML service keep the boundary clear while allowing later optimization.

## Compatibility

This ADR consumes the ADR-002 bound track, persists no raw audio per ADR-004, and uses the native service topology in ADR-005.

