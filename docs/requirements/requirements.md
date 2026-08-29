# SWAR Requirements Contract

Status: FROZEN - Phase A  
Contract date: 2026-08-28  
Project: SWAR - Synthetic-voice Warning and Authentication in Real-time  
Problem statement: SIH26104 - AI-Powered Real-Time Detection and Prevention of Voice Cloning Impersonation Attacks

This document is the normative Phase A requirements baseline. Later phases may refine implementation detail, but may not change scope, semantics, or security boundaries without an approved decision record and traceability update.

## 1. Source register

Authority follows the repository order in `AGENTS.md`; a lower source cannot override a higher one.

| Source ID | Title | Version or date | Authority | Use in this contract |
|---|---|---|---|---|
| SRC-001 | User Phase A implementation request and SWAR naming clarification | Conversation dated 2026-08-28; Phase A prompt SHA-256 `d9c2d2d1a3fa56888c333c844ffd74d09631485991778f8ad6e48650a58d5c4d` as identified in the prompt pack | 1 - latest explicit user instruction | Authorizes Phase A only and makes SWAR the current product name. |
| SRC-002 | `AGENTS.md` - SWAR Repository Engineering Contract | 1.0.0; architecture freeze 2026-08-28 | 2 - repository contract | Governs product boundaries, ownership, technology, security, risk semantics, phase order, and handoff evidence. |
| SRC-003 | SIH26104 problem statement | Title and ID reproduced in SRC-002, SRC-004, and SRC-005; separate official source file not present | Approved project input, subject to provenance validation | Establishes the challenge topic only; it does not prove a specific implementation or metric. |
| SRC-004 | `SIH26104_VIGIL_Official_Submission (3).pptx` | Six-slide official submission; authored version not stated; file metadata 2026-08-28; SHA-256 `1030370B38A5C17F8C6AEC94C93F0DDADFC6A6E3D2178EC867C426B87DE5B67A` | 4 - submitted presentation | Supplies product narrative, threat framing, evidence roles, intervention concept, and validation themes. `VIGIL` is a legacy name. |
| SRC-005 | `SIH26104_VIGIL_Updated_Architecture_Report.pdf` | Architecture report v2.0; 2026-08-27; SHA-256 `41A7FCDDA77F4F091E38055C6CCAE23E7F417424FD19D4320AB819FD297AE79C` | 4 - submitted technical report | Supplies detailed requirements candidates, risks, evaluation categories, and architectural rationale. Conflicting details are not adopted. |
| SRC-006 | `VIGIL_Phase_A_to_Z_Backend_First_Implementation_Prompts.pdf` | Prompt pack dated 2026-08-28; 64 pages; Phase A prompt hash recorded under SRC-001 | Active Phase A prompt only; later prompts are inactive roadmap material | Confirms A-Z dependencies and the Phase A exit gate. It does not authorize later phases in this implementation. |

### 1.1 Source conflicts and resolutions

| Conflict ID | Conflict | Resolution for the frozen contract |
|---|---|---|
| CON-001 | SRC-004 through SRC-006 call the product VIGIL; SRC-001 and SRC-002 call it SWAR. | Use SWAR everywhere in repository artifacts. Treat VIGIL as legacy source terminology. |
| CON-002 | SRC-005 calls itself the final source of truth. | Apply the authority order in SRC-002; the report is supporting input below the root contract. |
| CON-003 | SRC-004 and SRC-005 include WebRTC/SIP and contact-centre scope; SRC-002 freezes the SIH media path on backend-authorized LiveKit/WebRTC. | LiveKit/WebRTC is the SIH implementation scope. SIP and contact-centre adapters are `FUTURE ENTERPRISE INTEGRATION`. |
| CON-004 | SRC-004 and SRC-005 assign prototype state/locks/fan-out to Redis; SRC-002 says not to introduce Redis and permits PostgreSQL-backed or single-process jobs. | Redis is not a Phase A-Q requirement and is excluded from the SIH single-node build. |
| CON-005 | SRC-005 uses `LOW RISK - IDENTITY MATCH`, `WATCH`, `INCONCLUSIVE`, `AUTHENTICATED`, and other state labels; SRC-002 freezes four user-facing risk states. | The only user-facing risk states are `VERIFIED`, `UNVERIFIED`, `HIGH_RISK`, and `CRITICAL`. ML inability to decide is an `INSUFFICIENT_EVIDENCE` evidence outcome, not an accusation or a fifth business risk state. |
| CON-006 | SRC-004 and SRC-005 name datasets, checkpoints, languages, platform capabilities, and a 10/10 architecture self-score without repository evidence. | Keep them as `VALIDATION REQUIRED`; do not treat availability, license, compatibility, coverage, performance, or score as verified. |
| CON-007 | SRC-005 suggests fake evidence early in the development loop. | Any fake-evidence path is limited to the guarded Phase M development/test stub allowed by SRC-002; it is not a production requirement. |
| CON-008 | SRC-005 says Docker is not required, while SRC-002 prohibits Docker. | The stronger rule applies: Docker, Compose, Testcontainers, and container-only workflows are prohibited. |

## 2. Classification vocabulary

Requirements and claims use only these classifications:

- `VERIFIED FROM PROJECT DOCUMENTS`: explicitly fixed by SRC-001 or SRC-002.
- `VERIFIED FROM EXTERNAL DOCUMENTATION`: supported by reviewed authoritative external evidence; none is newly granted this status in Phase A.
- `ENGINEERING DECISION`: a selected design within the approved product boundary.
- `ASSUMPTION REQUIRING VALIDATION`: evidence is missing and must be obtained before reliance.
- `FUTURE ENTERPRISE INTEGRATION`: intentionally outside the SIH implementation gate.

## 3. Problem and outcome

### 3.1 Precise problem sentence

Enterprise-controlled voice workflows can be manipulated when a cloned or replayed voice resembles a trusted speaker and the surrounding business process treats familiarity as authorization without independent, quality-aware, time-accumulated security evidence.

### 3.2 Core outcome

SWAR must analyze the backend-authorized caller track, keep expected-speaker similarity separate from synthetic-speech evidence, abstain when audio is unreliable, and warn or hold a protected action when versioned temporal policy determines impersonation risk is high.

Primary users, threat actors, protected actions, exclusions, and future integrations are normative in [scope.md](scope.md).

## 4. Functional requirements

### 4.1 Identity, tenancy, and authorization

| ID | Requirement | Classification |
|---|---|---|
| FR-AUTH-001 | NestJS shall authenticate enterprise users and support access-token issuance plus rotated, revocable refresh sessions. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-AUTH-002 | NestJS shall authorize every tenant-owned operation using organization membership and role, and every service/repository data path shall scope access by `organization_id`. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-AUTH-003 | The system shall reject IDOR and cross-tenant access at service/repository boundaries, not only at controllers. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-AUTH-004 | Privileged policy, enrollment, audit, dashboard, and call operations shall require explicit roles and produce non-sensitive audit evidence. | ENGINEERING DECISION |

### 4.2 Controlled secure calls and media binding

| ID | Requirement | Classification |
|---|---|---|
| FR-CALL-001 | SWAR shall protect only authenticated enterprise-controlled LiveKit/WebRTC calls authorized by NestJS. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-CALL-002 | NestJS shall create calls, issue least-privilege short-lived room grants, end calls, and validate signed LiveKit webhooks. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-CALL-003 | NestJS shall maintain the authoritative binding among `organization_id`, `call_id`, room name, participant identity, and published caller `track_sid`. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-CALL-004 | The ML subscriber shall analyze the same caller participant/track delivered through the authorized room and shall reject a missing or mismatched binding. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-CALL-005 | A caller client shall never self-assert the trusted employee identity used for risk decisions. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-CALL-006 | Call, token, binding, end, webhook, and retry operations shall use explicit errors and bounded, idempotent behavior where replay is possible. | VERIFIED FROM PROJECT DOCUMENTS |

### 4.3 Trusted-speaker enrollment and lifecycle

| ID | Requirement | Classification |
|---|---|---|
| FR-ENR-001 | The system shall record explicit, purpose- and version-bound consent before collecting trusted-speaker enrollment audio. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-ENR-002 | Enrollment shall use several accepted samples where the workflow permits and shall reject clipped, noisy, corrupt, or insufficient speech. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-ENR-003 | Enrollment inference shall create versioned ECAPA-derived embeddings; reusable plaintext voiceprints and full enrollment audio shall not be persisted by default. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-ENR-004 | Stored voiceprints shall be encrypted with key/version metadata and tenant scope. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-ENR-005 | Authorized users shall be able to revoke consent, delete the voiceprint, and re-enroll; deletion and revocation shall be auditable without retaining the deleted biometric material. | VERIFIED FROM PROJECT DOCUMENTS |

### 4.4 Identity evidence

| ID | Requirement | Classification |
|---|---|---|
| FR-ID-001 | ECAPA-TDNN shall answer only how similar a valid speech window is to the enrolled expected speaker. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-ID-002 | Identity evidence shall never claim liveness, physical presence, authentication, or safety. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-ID-003 | Every identity result shall identify the model/version, checkpoint hash, score name and direction, window sequence/time range, processing latency, voiceprint version, and readiness/error state. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-ID-004 | Identity thresholds and score semantics shall remain provisional until validated and versioned. | ASSUMPTION REQUIRING VALIDATION |

### 4.5 Synthetic-speech evidence

| ID | Requirement | Classification |
|---|---|---|
| FR-SPOOF-001 | RawNet2 shall occupy the fast spoof-evidence path and AASIST the asynchronous deep-evidence path unless a later validated, approved model decision changes the logical slots. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-SPOOF-002 | Neither spoof model shall automatically override the other; late deep evidence shall revise the same window deterministically. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-SPOOF-003 | Raw logits shall not be represented as probabilities until score semantics and calibration are verified. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-SPOOF-004 | Every spoof result shall identify model/version, checkpoint hash, score name/direction, window sequence/time range, revision, processing latency, calibration version, and readiness/error state. | VERIFIED FROM PROJECT DOCUMENTS |

### 4.6 Audio quality and evidence abstention

| ID | Requirement | Classification |
|---|---|---|
| FR-QUAL-001 | The ML service shall estimate speech sufficiency and reliability, including inadequate voiced duration, noise/signal quality, clipping, discontinuity/packet gaps, sample validity, and corrupt or unsupported input. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-QUAL-002 | Unreliable input shall produce `INSUFFICIENT_EVIDENCE` with reason codes and continued monitoring; it shall not automatically produce `CRITICAL` or a synthetic accusation. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-QUAL-003 | Audio preprocessing shall be deterministic, model-appropriate, and linked to the authorized track and window sequence. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-QUAL-004 | Live audio, enrollment samples, embeddings, tensors, sessions, and transient buffers shall be released at call/enrollment termination and on error. | VERIFIED FROM PROJECT DOCUMENTS |

### 4.7 Temporal risk and policy

| ID | Requirement | Classification |
|---|---|---|
| FR-RISK-001 | NestJS shall be the only owner of context-aware policy, temporal aggregation, hysteresis, business risk state, and intervention selection. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-RISK-002 | The user-facing risk matrix shall be: high identity + low spoof = `VERIFIED`; low identity + low spoof = `UNVERIFIED`; low identity + high spoof = `HIGH_RISK`; high identity + high spoof = `CRITICAL`. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-RISK-003 | `UNVERIFIED` shall never be labelled `SAFE`, and `CRITICAL` shall be presented as likely synthetic impersonation requiring intervention or independent verification, not as legal proof of fraud. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-RISK-004 | Risk shall accumulate over versioned, quality-valid evidence with persistence and separate entry/clearing rules; late, duplicate, or stale revisions shall be handled deterministically and idempotently. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-RISK-005 | Every risk event shall store evidence references plus model, checkpoint, calibration, threshold, policy, and schema versions. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-RISK-006 | Initial thresholds, smoothing, persistence, and hysteresis settings shall be identified as provisional until calibration and scenario validation are complete. | ASSUMPTION REQUIRING VALIDATION |

### 4.8 Intervention and trusted verification

| ID | Requirement | Classification |
|---|---|---|
| FR-INT-001 | `HIGH_RISK` and `CRITICAL` shall create clear user warnings and enterprise security events; `CRITICAL` shall hold the associated sensitive action according to authorized policy. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-INT-002 | Holds, releases, retries, and security events shall be idempotent, organization-scoped, and bound to the specific call and protected action. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-INT-003 | A held action shall require an independent step-up or official callback workflow; caller voice alone shall not release the hold. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-INT-004 | A missed client warning, WebSocket disconnect, dashboard outage, delayed deep result, or ML degradation shall not silently release an active server-side hold. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-INT-005 | Production connectors to real bank-core transaction systems shall require a separate contract and authorization. | FUTURE ENTERPRISE INTEGRATION |

### 4.9 Public, realtime, and internal contracts

| ID | Requirement | Classification |
|---|---|---|
| FR-API-001 | Public REST APIs shall use `/api/v1` and stable validated request, response, and error envelopes. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-API-002 | Public operations shall cover session create/refresh/revoke, call create/token/end, enrollment/delete, active-call/risk-event query, step-up/callback verification, and authorized risk-policy get/update. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-API-003 | `/ws/security` shall publish versioned `risk.state.changed`, `intervention.required`, `call.ended`, and `dashboard.risk-event.created` events to authorized clients. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-API-004 | Backend-ML contracts shall cover analysis create/stop, ephemeral enrollment inference, `FAST`, `DEEP`, `INSUFFICIENT_EVIDENCE`, and `PIPELINE_ERROR`. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-API-005 | Machine-readable contracts under `docs/contracts/` shall be authoritative when created, and later client/service types shall be generated or drift-tested against them. | VERIFIED FROM PROJECT DOCUMENTS |

### 4.10 Dashboard and audit

| ID | Requirement | Classification |
|---|---|---|
| FR-DASH-001 | Authorized analysts shall be able to view active calls, risk-event timelines, evidence reason codes and versions, intervention state, and audit references without access to raw call audio. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-DASH-002 | Dashboard failure shall not stop customer protection, policy evaluation, or active holds. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-AUD-001 | The system shall create tenant-scoped audit records for authentication, consent, enrollment lifecycle, call authorization/binding, policy changes, risk transitions, interventions, step-up outcomes, and deletion. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-AUD-002 | Logs and audit records shall use correlation identifiers and shall exclude raw audio, embeddings, secrets, tokens, passwords, and private conversation content. | VERIFIED FROM PROJECT DOCUMENTS |
| FR-AUD-003 | Evidence, actions, and retries shall carry stable idempotency and sequence identifiers sufficient to reconstruct decisions without full call audio. | VERIFIED FROM PROJECT DOCUMENTS |

## 5. Non-functional requirements

| ID | Requirement | Verification intent |
|---|---|---|
| NFR-PRIV-001 | Voice audio and embeddings shall be treated as sensitive biometric-like data with purpose limitation, minimal retention, deletion/revocation, and audited access. | Retention inspection, deletion test, access-control test. |
| NFR-PRIV-002 | Full call audio shall not be persisted by default; transient audio shall remain only for the required session/inference duration. | Storage scan, runtime buffer lifecycle test, log scan. |
| NFR-PRIV-003 | Product wording shall be “privacy- and DPDP-aligned design” until legal review establishes any compliance claim. | Documentation and UI claim scan. |
| NFR-SEC-001 | External inputs shall be validated; errors shall be explicit; logs shall be structured and non-sensitive; retryable state changes shall be bounded and idempotent. | Contract, negative-path, log, and replay tests. |
| NFR-SEC-002 | LiveKit webhooks, backend-ML calls, WebSockets, media grants, and service identities shall be authenticated with least privilege and short lifetimes where applicable. | Signature/authentication, expiry, scope, and forgery tests. |
| NFR-SEC-003 | Secrets and real credentials shall never be committed or shipped to clients; production shall reject insecure defaults and development stubs. | Secret scan and production-startup tests. |
| NFR-REL-001 | Processing shall use bounded per-call memory/queues and drop or reject stale work rather than letting delayed evidence alter current state. | Load, stale-window, and recovery tests. |
| NFR-REL-002 | ML, media, WebSocket, dashboard, or model-path failure shall surface degraded/insufficient evidence and preserve safe intervention state. | Fault-injection scenarios. |
| NFR-COMP-001 | Native development shall support Windows PowerShell, native PostgreSQL, native LiveKit, Node/npm, and Python virtual environments without Docker. | Native setup and clean-machine verification. |
| NFR-COMP-002 | Frontend clients shall communicate only with documented NestJS APIs/WebSockets and the authorized LiveKit media plane, never directly with PostgreSQL or FastAPI. | Network/contract tests and architecture review. |
| NFR-ACC-001 | Android and dashboard workflows shall use text/icon cues in addition to color, scalable text, accessible labels, and keyboard navigation where applicable. | Android accessibility and web accessibility tests in Phases R-S. |
| NFR-ACC-002 | User interfaces shall represent loading, empty, offline, permission, expired-session, degraded-protection, and server-error states. | UI state tests in Phases R-S. |
| NFR-PERF-001 | End-to-end time to first intervention shall be measured from speech accumulation through delivery/UI; no fixed value may be claimed before benchmarking. | Timestamped end-to-end benchmark with p50/p95. |
| NFR-PERF-002 | Preprocessing, each model, fusion, policy, delivery, memory, queue depth, and supported concurrency shall be measured on declared target hardware. | Reproducible performance report; no invented target. |

## 6. ML and evaluation requirements

| ID | Requirement | Required evidence |
|---|---|---|
| MLR-GOV-001 | Every dataset and checkpoint shall have verified source, version, license/terms, checksum, provenance, expected sample format, and permitted use before adoption. | Governed manifest and license review. |
| MLR-GOV-002 | Model outputs shall document score name, direction, raw/calibrated semantics, readiness/error states, preprocessing contract, and checkpoint hash. | Model card, adapter tests, and contract fixtures. |
| MLR-ID-001 | Speaker verification shall report FAR, FRR, and EER on frozen, speaker-disjoint evaluation data, including declared slices. | Reproducible evaluation report and raw aggregate artifacts. |
| MLR-SPOOF-001 | Spoof detection shall report precision, recall, F1, and EER; FNR at declared fixed FPR may be added where protocol-valid. | Reproducible evaluation report with class and threshold definitions. |
| MLR-CAL-001 | Calibration shall be fitted only on a held-out calibration partition and evaluated with appropriate calibration measures such as Brier score, expected calibration error, and reliability plots when score semantics permit. | Frozen split manifest, calibrator version, and calibration report. |
| MLR-OOD-001 | Final evaluation shall reserve unseen generator families and report known-versus-unseen and worst-slice performance without training/test generator leakage. | Generator-disjoint manifest and OOD report. |
| MLR-ROB-001 | Robustness shall compare clean audio against declared codec, resampling, packet-gap, clipping, echo, and noise conditions on supported languages/slices. | Versioned degradation recipe and slice report. |
| MLR-LAT-001 | Streaming evaluation shall measure time to first provisional evidence, time to stable intervention, per-stage p50/p95 latency, stale-window drops, valid-window coverage, and insufficient-evidence rate. | Timestamped benchmark on declared hardware/configuration. |
| MLR-SAFE-001 | The four orchestration scenarios shall be tested: trusted genuine -> `VERIFIED`; unknown genuine -> `UNVERIFIED`; trusted clone -> `CRITICAL` plus warning/hold; insufficient audio -> continued monitoring without accusation. | Shared contract/E2E scenario evidence; explicitly not scientific detector proof. |
| MLR-LANG-001 | Any claim of English, Hindi, Kannada, or broader Indic coverage shall require licensed data, documented sample support, and per-language evaluation. | Language/data provenance and slice report. |

## 7. Persistent-domain minimum

Later domain/database phases shall account for organizations, users, organization memberships/roles, devices, refresh sessions, trusted speakers, enrollment consents, encrypted voiceprints, calls, call participants, media tracks/bindings, analysis sessions, risk policies/events, interventions/alerts, model versions, and audit logs. A persistent raw-call-audio entity is prohibited unless the user explicitly changes the privacy contract.

## 8. Change control

Each later phase shall map changed behavior back to these IDs and update [traceability-seed.md](traceability-seed.md). A requirement may be changed only by an explicit higher-authority instruction or approved decision record that identifies affected acceptance criteria, security/privacy consequences, and migration or compatibility impact.
