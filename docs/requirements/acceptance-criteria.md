# SWAR Acceptance Criteria

Status: FROZEN - Phase A  
Date: 2026-08-28

Each criterion is pass/fail, names at least one frozen requirement ID, and identifies the evidence type required. Passing orchestration criteria does not prove detector science unless the criterion explicitly requires an evaluated model result.

## 1. Phase A contract acceptance

| AC ID | Requirement IDs | Observable pass condition | Evidence type |
|---|---|---|---|
| AC-A-001 | FR-CALL-001, FR-RISK-002, NFR-COMP-001 | The six required Phase A Markdown artifacts exist; they use SWAR, controlled LiveKit/WebRTC, the four risk states, and the no-Docker boundary consistently. | Documentation inspection and deterministic term scan. |
| AC-A-002 | MLR-GOV-001, MLR-GOV-002, NFR-PERF-001 | Every submitted source is registered with title/version/date/authority where known, conflicts are recorded, and no dataset, checkpoint, metric, latency, integration, or compliance claim is promoted without evidence. | Source-register review and unsupported-claim scan. |
| AC-A-003 | FR-AUTH-001, FR-CALL-001, FR-ENR-001, FR-ID-001, FR-SPOOF-001, FR-QUAL-001, FR-RISK-001, FR-INT-001, FR-DASH-001, FR-AUD-001 | Every in-scope feature family has stable requirement IDs and a traceability row. | Requirement-ID inventory and traceability review. |
| AC-A-004 | NFR-PRIV-001, NFR-SEC-001, NFR-REL-001, NFR-COMP-001, NFR-ACC-001, NFR-PERF-001 | Privacy, security, reliability, compatibility, accessibility, and measurable-performance requirements are present without invented numeric targets. | Documentation inspection and numeric-claim scan. |
| AC-A-005 | MLR-ID-001, MLR-SPOOF-001, MLR-OOD-001, MLR-ROB-001, MLR-LAT-001 | Speaker FAR/FRR/EER, spoof precision/recall/F1/EER, unseen-generator, codec/noise robustness, and measured latency are required and linked to later evidence. | ML requirement/traceability inspection. |
| AC-A-006 | NFR-PRIV-001, NFR-PRIV-002, NFR-PRIV-003 | Exclusions and assumptions explicitly cover arbitrary cellular interception, zero latency, universal accuracy, legal compliance, raw-audio retention, and uncontracted bank-core integration. | Scope and assumption register inspection. |
| AC-A-007 | FR-API-005, FR-AUD-003 | Every acceptance-criteria table row contains at least one requirement ID and a non-empty evidence type. | Deterministic Markdown table check. |
| AC-A-008 | FR-RISK-002, FR-QUAL-002 | `VERIFIED`, `UNVERIFIED`, `HIGH_RISK`, and `CRITICAL` are the only user-facing risk states; insufficient audio is `INSUFFICIENT_EVIDENCE` and never an accusation. | Exact-token and forbidden-alias scan. |

## 2. Identity, tenancy, and call acceptance

| AC ID | Requirement IDs | Observable pass condition | Evidence type |
|---|---|---|---|
| AC-SYS-001 | FR-AUTH-001 | A valid user can create, refresh, and revoke a session; reuse of a revoked/rotated refresh session is rejected with a stable error. | Backend API integration tests. |
| AC-SYS-002 | FR-AUTH-002, FR-AUTH-003 | Cross-tenant identifiers cannot read or mutate calls, voiceprints, policies, evidence, interventions, or audit data through controller or direct service/repository paths. | RBAC/tenant-isolation negative tests. |
| AC-SYS-003 | FR-CALL-001, FR-CALL-002 | An authenticated authorized caller can obtain a short-lived LiveKit grant for the assigned room; unauthorized, expired, or over-scoped access is rejected. | API plus LiveKit authorization tests. |
| AC-SYS-004 | FR-CALL-003, FR-CALL-004, FR-CALL-005 | Analysis starts only when call, room, participant identity, and track SID equal the backend-authorized binding; substitution and client self-assertion are rejected. | Shared media-binding integration tests. |
| AC-SYS-005 | FR-CALL-006, NFR-SEC-002 | A forged or replayed LiveKit webhook/internal request is rejected, while a duplicate authenticated request has bounded idempotent behavior. | Signature/authentication and replay tests. |

## 3. Enrollment and privacy acceptance

| AC ID | Requirement IDs | Observable pass condition | Evidence type |
|---|---|---|---|
| AC-SYS-006 | FR-ENR-001, FR-ENR-002 | Enrollment cannot begin without current purpose/version consent; inadequate samples are rejected with non-accusatory reason codes. | Enrollment API/domain tests. |
| AC-SYS-007 | FR-ENR-003, FR-ENR-004, NFR-PRIV-002 | Successful enrollment persists an encrypted, versioned voiceprint record but no reusable plaintext embedding or full enrollment/call audio in database, files, or logs. | Storage inspection, encryption test, and sensitive-log scan. |
| AC-SYS-008 | FR-ENR-005, NFR-PRIV-001 | Authorized revocation/deletion makes the voiceprint unusable and removes protected material while preserving a non-sensitive audit record. | Lifecycle integration and deletion verification. |
| AC-SYS-009 | FR-QUAL-004, NFR-PRIV-002 | Call/enrollment completion and injected error paths clear transient buffers, embeddings, sessions, and tensors. | Resource-lifecycle and fault-injection tests. |

## 4. ML evidence and evaluation acceptance

| AC ID | Requirement IDs | Observable pass condition | Evidence type |
|---|---|---|---|
| AC-ML-001 | FR-ID-001, FR-ID-002, FR-ID-003 | ECAPA output reports similarity semantics and required versions/timing without claiming liveness, physical presence, or authorization. | Model-adapter unit/contract tests. |
| AC-ML-002 | FR-SPOOF-001, FR-SPOOF-002, FR-SPOOF-004 | RawNet2 emits fast evidence and AASIST emits a later revision for the same window; deterministic revision handling neither blindly overrides nor duplicates the window. | Adapter and revision-sequence tests. |
| AC-ML-003 | FR-SPOOF-003, MLR-CAL-001 | Unverified raw logits are never labelled probabilities; any calibrated probability references a held-out calibrator and version. | Contract tests and calibration artifact inspection. |
| AC-ML-004 | FR-QUAL-001, FR-QUAL-002 | Silence/short speech, severe noise, clipping, discontinuity, unsupported format, and corrupt audio produce reasoned `INSUFFICIENT_EVIDENCE` and continued monitoring, never `CRITICAL` solely from quality. | Preprocessing/quality negative tests. |
| AC-ML-005 | MLR-GOV-001, MLR-GOV-002 | Each promoted checkpoint/dataset has a verified manifest covering source, version, license, checksum, format, provenance, score direction, and preprocessing contract. | Model/data governance review gate. |
| AC-ML-006 | MLR-ID-001 | Frozen speaker-disjoint evaluation reports FAR, FRR, and EER with threshold and slice definitions. | Reproducible speaker evaluation report. |
| AC-ML-007 | MLR-SPOOF-001 | Frozen spoof evaluation reports precision, recall, F1, and EER with positive-class and threshold definitions. | Reproducible spoof evaluation report. |
| AC-ML-008 | MLR-OOD-001 | Complete generator families reserved from training are evaluated separately and leakage checks pass. | Split manifest, leakage report, and OOD results. |
| AC-ML-009 | MLR-ROB-001, MLR-LANG-001 | Clean results are compared with declared codec/noise/degradation and claimed language slices using versioned recipes and licensed data. | Robustness/language slice report. |
| AC-ML-010 | MLR-LAT-001, NFR-PERF-001, NFR-PERF-002 | Declared hardware benchmarks report speech accumulation and per-stage/end-to-end p50/p95, queue/memory, coverage, stale drops, and time to stable intervention without presenting configured window size as measured latency. | Performance benchmark and timestamp trace. |

## 5. Risk, intervention, dashboard, and audit acceptance

| AC ID | Requirement IDs | Observable pass condition | Evidence type |
|---|---|---|---|
| AC-RISK-001 | FR-RISK-001, FR-RISK-002, MLR-SAFE-001 | High identity + low spoof produces `VERIFIED` through NestJS policy. | Unit/contract and shared orchestration scenario. |
| AC-RISK-002 | FR-RISK-002, FR-RISK-003, MLR-SAFE-001 | Low identity + low spoof produces `UNVERIFIED`; no output calls it safe or authenticated. | Unit/contract and forbidden-word assertion. |
| AC-RISK-003 | FR-RISK-002, FR-INT-001 | Low identity + persistent high spoof produces `HIGH_RISK` and the policy-required warning/security event. | Temporal-policy and realtime contract test. |
| AC-RISK-004 | FR-RISK-002, FR-INT-001, FR-INT-002, MLR-SAFE-001 | High identity + persistent high spoof produces `CRITICAL`, one idempotent warning/event, and a call/action-bound hold. | Mandatory trusted-clone E2E scenario. |
| AC-RISK-005 | FR-RISK-004, FR-RISK-005 | Duplicate, stale, reordered, and late revisions lead to deterministic current state; every transition references evidence and all required versions. | Temporal replay/property tests and audit inspection. |
| AC-RISK-006 | FR-INT-003, FR-INT-004 | Caller voice cannot release a hold; authorized independent step-up can resolve it, and client/dashboard disconnects do not silently release it. | Domain/E2E fault and step-up tests. |
| AC-RISK-007 | FR-API-001, FR-API-002, FR-API-003, FR-API-004 | REST, WebSocket, and backend-ML operations validate typed contracts, authorization, versions, and stable errors; drift checks detect schema divergence. | OpenAPI/AsyncAPI/internal-schema validation and contract tests. |
| AC-RISK-008 | FR-DASH-001, FR-DASH-002 | An authorized analyst can reconstruct a risk/intervention timeline without raw audio, and dashboard outage does not stop policy/hold behavior. | Dashboard integration plus outage scenario. |
| AC-RISK-009 | FR-AUD-001, FR-AUD-002, FR-AUD-003 | Audit records are tenant-scoped, correlated, versioned, idempotent/reconstructable, and contain none of the prohibited sensitive payloads. | Audit integration and sensitive-data scan. |
| AC-RISK-010 | NFR-REL-001, NFR-REL-002 | Overload/model/media failures bound queues, reject stale work, expose degraded/insufficient protection, and preserve active holds without false low-risk output. | Load and fault-recovery tests. |

## 6. Four mandatory orchestration scenarios

| Scenario | Requirement IDs | Pass evidence |
|---|---|---|
| Genuine trusted speaker | FR-RISK-002, MLR-SAFE-001 | High identity + low spoof -> `VERIFIED`. |
| Unknown genuine speaker | FR-RISK-002, FR-RISK-003, MLR-SAFE-001 | Low identity + low spoof -> `UNVERIFIED`; never `SAFE`. |
| Trusted voice clone | FR-RISK-002, FR-INT-001, FR-INT-002, MLR-SAFE-001 | High identity + persistent high spoof -> `CRITICAL` -> warning + action hold. |
| Weak/insufficient audio | FR-QUAL-002, MLR-SAFE-001 | `INSUFFICIENT_EVIDENCE`; continue monitoring without accusation. |

These scenarios prove orchestration only. Scientific detector performance requires AC-ML-005 through AC-ML-010.
