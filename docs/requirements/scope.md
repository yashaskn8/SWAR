# SWAR Scope Freeze

Status: FROZEN - Phase A  
Date: 2026-08-28

## 1. Product boundary

SWAR is an enterprise-controlled LiveKit/WebRTC voice-security system. It checks whether the authorized caller track resembles an enrolled expected speaker, checks for synthetic-speech evidence, accounts for audio quality, combines evidence over time, and warns or holds a protected action when impersonation risk becomes high.

It is not a generic file-upload deepfake classifier and it does not treat a familiar voice as authorization.

## 2. Primary users

| User | Need | Authorized outcome |
|---|---|---|
| Enterprise customer/call recipient | Understand when a controlled call may involve synthetic impersonation and avoid acting under pressure. | Receive accessible warnings, end/report the call, and complete an independent step-up. |
| Trusted enterprise caller/employee | Enroll an expected-speaker representation with consent and use the controlled calling channel. | Manage consent/voiceprint lifecycle and participate in authorized calls. |
| Fraud or security analyst | Investigate current and historical risk events without listening to retained call audio. | View evidence timelines, versions, interventions, and audit references within the tenant. |
| Organization administrator/policy manager | Configure authorized users, retention, and risk policy within approved bounds. | Manage tenant-scoped access and versioned policy. |
| Platform operator/security engineer | Operate media, backend, and ML planes without access beyond least privilege. | Observe health and non-sensitive telemetry; respond to degraded protection. |

## 3. Threat actors and abuse paths

| Threat ID | Actor/path | Protected control |
|---|---|---|
| THR-001 | Attacker publishes TTS or voice-converted speech resembling an enrolled speaker. | Independent ECAPA identity relationship plus RawNet2/AASIST spoof evidence and temporal policy. |
| THR-002 | Unknown attacker publishes synthetic speech without an enrolled identity. | Persistent high spoof evidence maps to `HIGH_RISK`. |
| THR-003 | Attacker replays genuine, cloned, or partially manipulated speech. | Spoof evaluation, authorized-track binding, temporal evidence, and independent step-up. |
| THR-004 | Modified/untrusted client tries to submit substitute audio or self-assert a trusted identity. | Server-authorized participant/track binding and restricted ML subscription. |
| THR-005 | Attacker forges, replays, reorders, or duplicates evidence/intervention events. | Authenticated versioned contracts, sequence/revision rules, and idempotency. |
| THR-006 | Tenant user attempts cross-organization access to calls, voiceprints, policy, or evidence. | Organization-scoped authorization at service/repository boundaries. |
| THR-007 | Repeated calls probe thresholds or overload inference. | Rate/tenant limits, bounded queues, stale-work rejection, and non-detailed customer output. |
| THR-008 | Operator, log, or storage path exposes sensitive audio, embeddings, or secrets. | Minimal retention, encryption, least privilege, redaction, and auditable deletion. |

## 4. Protected actions

The SIH build shall demonstrate a backend-owned protected-action abstraction. Representative actions are:

- transfer or payment approval;
- OTP, password, credential, or private-information disclosure;
- beneficiary or credential change;
- privileged enterprise approval;
- release of a previously held action.

A real bank-core connector is not implied. The demonstrator must prove that the backend hold prevents the in-scope sample action from completing until independent verification succeeds.

## 5. In scope for the full A-Z program

| Scope ID | Capability | Requirements |
|---|---|---|
| SCP-001 | Enterprise authentication, organizations, roles, revocable sessions, and tenant isolation. | FR-AUTH-001 through FR-AUTH-004 |
| SCP-002 | NestJS-authorized LiveKit rooms, short-lived grants, webhook verification, and caller participant/track binding. | FR-CALL-001 through FR-CALL-006 |
| SCP-003 | Consented multi-sample trusted-speaker enrollment, encrypted voiceprints, revocation, and deletion. | FR-ENR-001 through FR-ENR-005 |
| SCP-004 | ECAPA expected-speaker similarity with explicit non-liveness semantics. | FR-ID-001 through FR-ID-004 |
| SCP-005 | RawNet2 fast and AASIST deep spoof evidence with calibration and late revisions. | FR-SPOOF-001 through FR-SPOOF-004 |
| SCP-006 | Quality-aware transient audio processing and `INSUFFICIENT_EVIDENCE`. | FR-QUAL-001 through FR-QUAL-004 |
| SCP-007 | NestJS temporal risk policy using `VERIFIED`, `UNVERIFIED`, `HIGH_RISK`, and `CRITICAL`. | FR-RISK-001 through FR-RISK-006 |
| SCP-008 | Accessible warning, backend action hold, independent step-up, security events, and audit. | FR-INT-001 through FR-INT-005; FR-AUD-001 through FR-AUD-003 |
| SCP-009 | Versioned REST, WebSocket, and backend-ML contracts. | FR-API-001 through FR-API-005 |
| SCP-010 | Android call/intervention workflows and React analyst/dashboard workflows after the Phase Q backend gate. | FR-DASH-001, FR-DASH-002; NFR-ACC-001, NFR-ACC-002 |
| SCP-011 | Leakage-resistant, licensed, reproducible model evaluation and measured end-to-end performance. | MLR-GOV-001 through MLR-LANG-001; NFR-PERF-001, NFR-PERF-002 |
| SCP-012 | Native no-Docker development, verification, deployment, and operational evidence. | NFR-COMP-001; phase gates D, V, X, Y, Z |

## 6. Phase A implementation boundary

Phase A creates Markdown requirements and status evidence only. It does not create application code, schemas, migrations, frontend assets, model adapters, datasets, checkpoints, infrastructure configuration, or numeric thresholds.

## 7. Explicit exclusions

| Exclusion ID | Excluded claim/capability | Reason |
|---|---|---|
| EXC-001 | Monitoring, intercepting, recording, or protecting arbitrary GSM, VoLTE, carrier, or third-party calls. | Outside the controlled media boundary and not available to an ordinary application. |
| EXC-002 | Blocking the first word or claiming zero/fixed intervention latency before measurement. | Approximately four-second windows and one-second stride require speech accumulation; full latency is end to end. |
| EXC-003 | Guaranteed, universal, generator-independent, language-independent, or legally dispositive detection accuracy. | Models are probabilistic and require declared evaluation. |
| EXC-004 | Calling an unknown or low-evidence caller `SAFE`. | Low identity plus low spoof is `UNVERIFIED`. |
| EXC-005 | Treating ECAPA similarity as liveness, physical presence, authentication, or authorization. | A convincing clone can resemble the enrolled speaker. |
| EXC-006 | Letting RawNet2, AASIST, the ML service, or a frontend independently choose the protected business action. | Business risk and intervention belong to NestJS. |
| EXC-007 | Persistent raw call audio or reusable plaintext voiceprints by default. | Violates the privacy/minimal-retention contract. |
| EXC-008 | Automatic legal or DPDP compliance claims. | Formal compliance requires deployment-specific legal review. |
| EXC-009 | Real bank-core, government, fraud-desk, passkey-provider, or official-callback integration without a contract and authorization. | External production integration is not present. |
| EXC-010 | Docker, Docker Compose, Testcontainers, container-only local setup, Kubernetes, Kafka, blockchain, an LLM, RAG, vector database, or required Redis. | Prohibited or unnecessary for the SIH build. |
| EXC-011 | Frontend production implementation before Phase R or before the Phase Q backend-completion gate passes. | Backend-first phase order is mandatory. |
| EXC-012 | Invented thresholds, model metrics, dataset/checkpoint availability, checkpoint score semantics, licenses, latency, scale, or test results. | Evidence has not yet been produced. |

## 8. Future enterprise integrations

These items may be evaluated after the SIH contract is satisfied. They are not promised prototype features:

- SIP/contact-centre adapters around the same authorized media and policy boundaries;
- production bank-core or workflow-engine action holds;
- enterprise passkey, fraud-desk, official-callback, branch, or supervisor integrations;
- multi-region/on-premises worker pools and hardware-specific optimization;
- endpoint inference for server-blind end-to-end encrypted deployments;
- broader Indic-language coverage after licensed-data and per-language validation;
- separately authorized forensic recording with explicit policy, legal basis/consent, encryption, short retention, and audited access.

## 9. Outcome measures without invented targets

Success shall be evaluated by observable measures, not promises:

- valid calls bound to the authorized caller track;
- risk-state and intervention correctness in the four mandatory orchestration scenarios;
- sensitive sample actions held before completion when policy requires;
- independent step-up release/rejection outcomes;
- speaker FAR/FRR/EER and spoof precision/recall/F1/EER on frozen data;
- unseen-generator and codec/noise slice results;
- measured time to first evidence and stable intervention, including p50/p95 stage latency;
- valid-window coverage and `INSUFFICIENT_EVIDENCE` frequency;
- cross-tenant, replay, injection, retention, deletion, and failure-recovery test outcomes;
- reconstruction of decisions from versioned metadata without stored full call audio.
