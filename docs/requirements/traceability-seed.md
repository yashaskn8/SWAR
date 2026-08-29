# SWAR Requirements Traceability Seed

Status: FROZEN - Phase A  
Date: 2026-08-28

This seed links source authority to stable requirements, observable acceptance evidence, and the later phase expected to produce implementation evidence. Later phases shall refine rows rather than create disconnected requirement copies.

## 1. Source-to-requirement traceability

| Trace ID | Source and source topic | Requirement IDs | Acceptance IDs | Initial owner/evidence phase |
|---|---|---|---|---|
| TR-001 | SRC-001/SRC-002 - SWAR identity and Phase A-only authorization | AC-A contract; DEC-A-001 | AC-A-001, AC-A-002 | A |
| TR-002 | SRC-002 sections 5, 6, 8, 9 - controlled LiveKit/WebRTC and no Docker/Redis | FR-CALL-001..006; NFR-COMP-001; DEC-A-002..004 | AC-A-001, AC-SYS-003..005 | B, D, P, T |
| TR-003 | SRC-002 sections 7, 13 - ownership and public/internal boundaries | FR-API-001..005; NFR-COMP-002 | AC-RISK-007 | B, J |
| TR-004 | SRC-002 sections 10 and 19; SRC-004 slides 2-6; SRC-005 sections 6-10, 17 | FR-ID-001..004; FR-SPOOF-001..004; FR-QUAL-001..004; MLR-GOV-001..MLR-SAFE-001 | AC-ML-001..010 | K, L, N, O, P |
| TR-005 | SRC-002 section 11; SRC-004 slide 2; SRC-005 sections 10-11 | FR-RISK-001..006; FR-INT-001..004 | AC-RISK-001..006 | Q, T |
| TR-006 | SRC-002 section 12; SRC-005 sections 7, 14 | FR-ENR-001..005; NFR-PRIV-001..003; NFR-SEC-001..003 | AC-SYS-006..009, AC-RISK-009 | E, F, I, U |
| TR-007 | SRC-002 sections 13-14 | FR-AUTH-001..004; FR-AUD-001..003; persistent-domain minimum | AC-SYS-001..002, AC-RISK-009 | E, F, G, H |
| TR-008 | SRC-002 sections 13 and 19; SRC-005 sections 12-13 | FR-DASH-001..002; NFR-ACC-001..002 | AC-RISK-008 | R, S |
| TR-009 | SRC-002 sections 5.2, 15; SRC-004 slides 4-6; SRC-005 sections 17, 22 | NFR-PERF-001..002; MLR-ID-001; MLR-SPOOF-001; MLR-OOD-001; MLR-ROB-001; MLR-LAT-001; MLR-LANG-001 | AC-A-005, AC-ML-006..010 | O, Y, Z |
| TR-010 | SRC-002 section 19; SRC-005 section 19 | MLR-SAFE-001 | AC-RISK-001..004 and four mandatory scenarios | Q, T, V |
| TR-011 | SRC-005 SIP/contact-centre, real integrations, endpoint inference, forensic recording | FR-INT-005; FUT-001..006 | Separate future acceptance contract required | FUTURE ENTERPRISE INTEGRATION |
| TR-012 | SRC-006 A-Z dependency roadmap | Phase status A-Z | AC-A-001..008 | A-Z sequential gates |

## 2. Requirement-family ownership and evidence seed

| Requirement family | Requirement IDs | Owning component/container | First design/implementation phase | Primary acceptance evidence |
|---|---|---|---|---|
| Authentication and tenancy | FR-AUTH-001..004 | NestJS backend/PostgreSQL | B, E, F, G | AC-SYS-001, AC-SYS-002 |
| Controlled calls | FR-CALL-001..006 | NestJS + LiveKit + restricted ML subscriber | B, I, P | AC-SYS-003..005 |
| Enrollment | FR-ENR-001..005 | NestJS lifecycle + ephemeral ML inference + PostgreSQL encrypted record | E, F, I, P | AC-SYS-006..009 |
| Identity evidence | FR-ID-001..004 | ML service | K, L, N, O, P | AC-ML-001, AC-ML-005, AC-ML-006 |
| Spoof evidence | FR-SPOOF-001..004 | ML service | K, L, N, O, P | AC-ML-002, AC-ML-003, AC-ML-005, AC-ML-007 |
| Quality/abstention | FR-QUAL-001..004 | ML service | L, P | AC-ML-004, AC-SYS-009 |
| Temporal risk | FR-RISK-001..006 | NestJS backend | I, Q | AC-RISK-001..005 |
| Intervention/step-up | FR-INT-001..005 | NestJS backend; UI is a consumer after Q | I, Q, S | AC-RISK-003, AC-RISK-004, AC-RISK-006 |
| Contracts/realtime | FR-API-001..005 | `docs/contracts/`, NestJS, ML adapters, generated clients | J | AC-RISK-007 |
| Dashboard | FR-DASH-001..002 | React dashboard via NestJS only | R, S | AC-RISK-008 |
| Audit | FR-AUD-001..003 | NestJS/PostgreSQL | F, I, Q | AC-RISK-009 |
| Privacy | NFR-PRIV-001..003 | Cross-cutting | B, U | AC-SYS-007..009, AC-RISK-009 |
| Security | NFR-SEC-001..003 | Cross-cutting | G, U | AC-SYS-002, AC-SYS-005, AC-RISK-007, AC-RISK-009 |
| Reliability | NFR-REL-001..002 | Backend/ML/media | P, Q, Y | AC-RISK-005, AC-RISK-006, AC-RISK-010 |
| Compatibility | NFR-COMP-001..002 | Infrastructure and integration boundaries | D, T, X | AC-A-001, AC-SYS-003, AC-RISK-007 |
| Accessibility | NFR-ACC-001..002 | Android and React | R, S | UI accessibility/state suites |
| Performance | NFR-PERF-001..002 | ML + backend + frontend delivery | O, Y | AC-ML-010 |
| ML governance/evaluation | MLR-GOV-001..MLR-LANG-001 | ML/data workspace | K, O, W | AC-ML-005..010 |

## 3. Phase dependency and artifact map

| Phase | Depends on | Expected evidence/artifact |
|---|---|---|
| A | Root contract and approved sources | Frozen requirements, scope, assumptions, acceptance, traceability, phase ledger. |
| B | A | System architecture, trust boundaries, component ownership, ADRs. |
| C | A, B | Repository and engineering foundation. |
| D | C | Native no-Docker local environment. |
| E | A, B, C | Domain/data model. |
| F | D, E | Prisma/PostgreSQL persistence and migration evidence. |
| G | F and A role requirements | Authentication/authorization and tenant-isolation evidence. |
| H | C, F, G | NestJS platform foundation. |
| I | E, F, G, H | Core domain workflows. |
| J | G, H, I | Public/realtime/internal machine-readable contracts and drift tests. |
| K | A ML requirements, B, C | Governed data acquisition/manifests/licenses. |
| L | J, K | Deterministic audio preprocessing and feature pipeline. |
| M | H, J, K, L | ML baseline and guarded development loop. |
| N | K, L, M | Real model adapters/checkpoints and experiments. |
| O | K, L, N | Evaluation, calibration, safety/promotion gates. |
| P | H, J, L, N, O | ML serving and authorized LiveKit subscriber. |
| Q | F, G, I, J, O, P | Backend temporal risk, interventions, versioned security events; backend-completion gate. |
| R | Q PASS and J contracts | Frontend foundations only after backend gate. |
| S | J, Q, R | Android/React user workflows and realtime intervention. |
| T | D, P, Q, S | Native end-to-end integration and four scenarios. |
| U | B, G, Q, T | Security/privacy hardening. |
| V | T, U and component tests | Complete test engineering and quality gates. |
| W | O, U, V | MLOps, governance, native CI/CD. |
| X | D, U, V, W | Native deployment/infrastructure packaging. |
| Y | T, V, X | Observability, performance, resilience validation. |
| Z | V, W, X, Y evidence | Final SIH audit, red-team, measured claims, submission readiness. |

## 4. Traceability update rule

Every later implementation phase shall:

1. cite the affected requirement and acceptance IDs;
2. link the concrete contract, migration, test, benchmark, or review artifact;
3. record pass/fail evidence in `docs/implementation/phase-status.md`;
4. preserve open `VALIDATION REQUIRED` items when evidence is absent; and
5. avoid creating a second schema or risk vocabulary that conflicts with the authoritative contract.

## 5. Phase B architecture evidence

Phase B freezes ownership and runtime boundaries without changing the Phase A requirement semantics.

| Evidence area | Architecture artifact | Requirement/decision coverage |
|---|---|---|
| System actors, controlled boundary, protected action and exclusions | [System context](../architecture/system-context.md) | FR-CALL-001..006; FR-RISK-001..006; FR-INT-001..005; ADR-001 |
| Containers, protocols, authentication, payload classes, data ownership | [Containers](../architecture/containers.md) | FR-AUTH, FR-CALL, FR-API, FR-DASH, FR-AUD; NFR-COMP/SEC/PRIV |
| NestJS/ML components, state model, all 72 requirement owners | [Components and ownership](../architecture/components.md) | Every Phase A FR/NFR/MLR ID; explicit FUTURE/VALIDATION status where applicable |
| Authorized call, binding, evidence, intervention, enrollment, deletion and step-up sequences | [Runtime data flow](../architecture/data-flow.md) | FR-CALL, FR-ENR, FR-RISK, FR-INT, FR-AUD |
| FAST/DEEP/identity/quality/calibration/revision semantics | [AI flow](../architecture/ai-flow.md) | FR-ID, FR-SPOOF, FR-QUAL, FR-RISK; MLR-GOV/CAL/LAT/SAFE |
| Trust boundaries, service credentials, audio/embedding lifetime, red-team controls | [Security boundaries](../architecture/security-boundaries.md) | FR-AUTH/CALL/ENR/AUD; NFR-PRIV/SEC |
| Required degraded behavior and edge cases | [Failure and fallback](../architecture/failure-fallback.md) | FR-CALL-006, FR-QUAL, FR-RISK-004, FR-INT-004; NFR-REL |
| Native development and non-container production topology | [Deployment](../architecture/deployment.md) | NFR-COMP-001, NFR-SEC-003, NFR-REL-002; ADR-005 |
| Controlled WebRTC scope | [ADR-001](../decisions/ADR-001-controlled-webrtc-scope.md) | DEC-A-002/003; FR-CALL-001/002 |
| Authoritative caller-track binding | [ADR-002](../decisions/ADR-002-server-bound-caller-track.md) | FR-CALL-003..006 |
| ML evidence versus backend policy/action ownership | [ADR-003](../decisions/ADR-003-risk-responsibility-split.md) | FR-ID/SPOOF/RISK/INT; MLR-CAL-001 |
| No raw-audio retention and encrypted voiceprint lifecycle | [ADR-004](../decisions/ADR-004-no-raw-audio-retention.md) | FR-ENR, FR-QUAL-004, FR-AUD-002; NFR-PRIV |
| Native no-Docker development/deployment | [ADR-005](../decisions/ADR-005-native-no-docker-development.md) | NFR-COMP-001, NFR-SEC-003, NFR-REL-002 |

## 6. Phase C repository evidence

Phase C implements the engineering foundation without changing frozen requirement semantics or creating product workflows.

| Evidence area | Repository artifact | Requirement/acceptance coverage |
|---|---|---|
| Service ownership, dependency isolation, branch/migration/generated-contract conventions | [Root README](../../README.md) | NFR-COMP-001, NFR-COMP-002, FR-API-005 |
| Strict NestJS foundation and actual liveness contract | [`backend/`](../../backend/) | NFR-SEC-001, NFR-COMP-001; Phase C backend gate |
| Typed FastAPI foundation with no model loading | [`ml/`](../../ml/) | NFR-SEC-001, NFR-COMP-001; Phase C ML gate |
| Frontend remains documentation-only until its backend gate | [Frontend placeholder](../../frontend/README.md) | NFR-COMP-002, EXC-011 |
| Container and cross-layer dependency rejection | [Repository boundary check](../../infrastructure/checks/repository-boundaries.ps1) | NFR-COMP-001, NFR-COMP-002, NFR-SEC-003 |
| Authoritative machine-readable contract location reserved for Phase J | [Contracts README](../contracts/README.md) | FR-API-005 |

Concrete command outcomes are recorded in [Phase C exit-gate evidence](../implementation/phase-status.md#phase-c-exit-gate-evidence).

## 7. Phase D native-environment evidence

Phase D provides the native Windows execution contract without creating schemas, application workflows, model behavior, or frontend code.

| Evidence area | Repository artifact | Requirement/acceptance coverage |
|---|---|---|
| Canonical safe-placeholder environment contract | [`.env.example`](../../.env.example) | NFR-COMP-001, NFR-SEC-003, ADR-005 |
| Tool, port, and PostgreSQL readiness diagnostics | [Prerequisite check](../../infrastructure/local-windows/check-prerequisites.ps1) | NFR-COMP-001, NFR-REL-002 |
| Typed backend configuration, safe error/logging envelope, request IDs, validation, readiness and bounded idempotency | [Backend module boundaries](../backend/module-boundaries.md) | FR-API-001, FR-AUD-002, FR-AUD-003, NFR-SEC-001, NFR-REL-002 |
| Idempotent role/database-only bootstrap | [PostgreSQL bootstrap](../../infrastructure/postgres/bootstrap.sql) | NFR-SEC-003; Phase F dependency only |
| Credential-free LAN-capable media configuration | [LiveKit template](../../infrastructure/livekit/livekit.dev.yaml) | FR-CALL-001, NFR-COMP-001, NFR-SEC-003 |
| Bounded native process lifecycle | [Start/stop scripts](../../infrastructure/local-windows/) | NFR-REL-001, NFR-REL-002 |
| Reproducible setup, LAN/firewall, recovery, and verification | [Native Windows guide](../setup/native-windows.md) | NFR-COMP-001, NFR-SEC-003 |

Concrete command outcomes are recorded in [Phase D exit-gate evidence](../implementation/phase-status.md#phase-d-exit-gate-evidence).

## 8. Phase I domain-workflow evidence

Phase I implements the protected backend workflows without adding transport contracts, model behavior, risk thresholds, frontend code, or a production enterprise integration.

| Evidence area | Implementation/documentation artifact | Requirement/acceptance coverage |
|---|---|---|
| Call lifecycle, server identities, least-privilege grants, and cleanup | [Backend domain workflows](../backend/domain-workflows.md), [`CallsService`](../../backend/src/modules/calls/calls.service.ts), and [`LiveKitPort`](../../backend/src/integrations/livekit/livekit.port.ts) | FR-CALL-001..006; AC-SYS-003..005 |
| Signed exact caller-track binding and republish handling | [`TrackBindingService`](../../backend/src/modules/media/track-binding.service.ts) | FR-CALL-003..006; NFR-SEC-001..003; AC-SYS-005 |
| Consent, transient enrollment, encrypted activation, revocation, and deletion | [`TrustedSpeakersService`](../../backend/src/modules/trusted-speakers/trusted-speakers.service.ts) and [`VoiceEnrollmentService`](../../backend/src/modules/voice-enrollment/voice-enrollment.service.ts) | FR-ENR-001..005; NFR-PRIV-001..003; AC-SYS-006..009 |
| Analysis authorization and provider recovery | [`AnalysisService`](../../backend/src/modules/analysis/analysis.service.ts) and [`MlControlPort`](../../backend/src/integrations/ml/ml-control.port.ts) | FR-CALL-004..006; NFR-REL-001..002; AC-RISK-005, AC-RISK-010 |
| Stable security events, audit, and replaceable protected-action intervention | [`SecurityEventsService`](../../backend/src/modules/security-events/security-events.service.ts), [`AuditService`](../../backend/src/modules/audit/audit.service.ts), and [`InterventionPort`](../../backend/src/modules/interventions/intervention.port.ts) | FR-INT-001..005; FR-AUD-001..003; AC-RISK-003, AC-RISK-004, AC-RISK-006, AC-RISK-009 |
| Complete transition and workflow edge-case verification | [Phase I focused tests](../../backend/tests/unit/domain/domain-workflows.spec.ts) | Legal/illegal transitions, authorization, provider failure, republish, revocation race, retry stability, and demo-adapter labeling |

Concrete command outcomes are recorded in [Phase I exit-gate evidence](../implementation/phase-status.md#phase-i-exit-gate-evidence).

## 9. Phase J API and contract evidence

Phase J turns the Phase I workflows into versioned, authenticated transport adapters without implementing model inference, risk thresholds, frontend behavior, or a production enterprise integration.

| Evidence area | Implementation/contract artifact | Requirement/acceptance coverage |
|---|---|---|
| Versioned public REST, validation, safe responses, permissions, idempotency and rate categories | [REST OpenAPI](../contracts/public-rest.openapi.yaml), [adapter register](../backend/api-contracts.md), and backend controllers | FR-API-001, FR-API-002, FR-AUTH-001..004; AC-RISK-007 |
| Authenticated tenant/call subscription, acknowledgement, bounded replay and deduplication | [Security AsyncAPI](../contracts/security-events.asyncapi.yaml) and [`SecurityEventsGateway`](../../backend/src/modules/security-events/security-events.gateway.ts) | FR-API-003, FR-DASH-001..002, NFR-REL-001..002 |
| Signed webhook verification before authoritative track binding | [`LiveKitWebhookController`](../../backend/src/modules/media/livekit-webhook.controller.ts) | FR-CALL-003..006, NFR-SEC-001..003; AC-SYS-005 |
| Backend-to-ML control and ML-to-backend FAST/DEEP/abstention/error semantics | [ML control OpenAPI](../contracts/ml-control.openapi.yaml), [ML evidence OpenAPI](../contracts/ml-evidence.openapi.yaml), and [evidence JSON Schema](../contracts/schemas/ml-evidence.v1.json) | FR-API-004..005, FR-ID-001..004, FR-SPOOF-001..004, FR-QUAL-001..004 |
| Consent, transient upload, no-public-biometric response, revocation and deletion | [`VoiceEnrollmentController`](../../backend/src/modules/voice-enrollment/voice-enrollment.controller.ts) and [REST OpenAPI](../contracts/public-rest.openapi.yaml) | FR-ENR-001..005, NFR-PRIV-001..003; AC-SYS-006..009 |
| Independent verification boundary and persisted PASSED challenge requirement | [`InterventionsController`](../../backend/src/modules/interventions/interventions.controller.ts) | FR-INT-001..005, NFR-SEC-001; AC-RISK-006 |
| Snapshot/reference/schema/enum/auth/binding/replay drift verification | [Phase J contract tests](../../backend/tests/contract/) | FR-API-001..005, NFR-COMP-002, NFR-SEC-001..003; AC-RISK-007 |

Concrete command outcomes are recorded in [Phase J exit-gate evidence](../implementation/phase-status.md#phase-j-exit-gate-evidence).
