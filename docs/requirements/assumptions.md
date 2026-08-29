# SWAR Assumption and Validation Register

Status: FROZEN - Phase A  
Date: 2026-08-28

An item remains open until the stated evidence is reviewed and its closure is linked from [traceability-seed.md](traceability-seed.md). Open assumptions cannot be restated as facts.

## 1. Open assumptions

| ID | Classification | Assumption or uncertainty | Affected requirements | Evidence required to close | Owning phase | Status |
|---|---|---|---|---|---|---|
| ASM-001 | ASSUMPTION REQUIRING VALIDATION | The organization can control both the LiveKit communication session and the sample protected-action workflow. | FR-CALL-001, FR-INT-001, FR-INT-002 | Approved architecture and end-to-end demonstration showing server authorization, call binding, and an enforceable sample hold. | B, I, T | OPEN - VALIDATION REQUIRED |
| ASM-002 | ASSUMPTION REQUIRING VALIDATION | LiveKit server and Python RTC dependencies expose the raw authorized participant/track frames and metadata required by the frozen binding contract. | FR-CALL-003, FR-CALL-004, FR-QUAL-003 | Current official documentation review, pinned compatible versions, and a participant/track-binding integration test. | B, D, P | OPEN - VALIDATION REQUIRED |
| ASM-003 | ASSUMPTION REQUIRING VALIDATION | Supported Android devices can sustain the in-app controlled call, permissions, background behavior, and warning delivery required for the demo. | NFR-COMP-002, NFR-ACC-001, NFR-ACC-002 | Declared device/OS matrix, official Android capability review, and device tests. | R, S, T | OPEN - VALIDATION REQUIRED |
| ASM-004 | ASSUMPTION REQUIRING VALIDATION | Candidate RawNet2, AASIST, and ECAPA-TDNN checkpoints have acceptable licenses and compatible inference formats. | FR-ID-003, FR-SPOOF-004, MLR-GOV-001, MLR-GOV-002 | Source/license records, checksums, model cards, exact preprocessing/score semantics, and adapter smoke tests. | K, N | OPEN - VALIDATION REQUIRED |
| ASM-005 | ASSUMPTION REQUIRING VALIDATION | ASVspoof 2021/5, IndicSynth, IndicVoices, IndieFake, or any replacement data can be lawfully obtained and used for the declared roles. | MLR-GOV-001, MLR-ID-001, MLR-SPOOF-001, MLR-OOD-001, MLR-LANG-001 | Dataset cards, license/terms review, provenance, hashes, consent/ethics constraints, and approved manifests. | K | OPEN - VALIDATION REQUIRED |
| ASM-006 | ASSUMPTION REQUIRING VALIDATION | A consented project corpus can be collected for exact LiveKit/channel calibration without violating privacy or reusing private call content. | FR-ENR-001, NFR-PRIV-001, MLR-ROB-001 | Approved protocol, consent text/version, purpose/retention rules, ethics/security review, and deletion evidence. | K, U | OPEN - VALIDATION REQUIRED |
| ASM-007 | ASSUMPTION REQUIRING VALIDATION | Identity, spoof, quality, calibration, temporal, and hysteresis thresholds can satisfy an acceptable security/usability tradeoff. | FR-ID-004, FR-RISK-006, MLR-CAL-001 | Frozen calibration/test partitions, threshold-selection protocol, cost assumptions, slice metrics, and approval record. | O, Q | OPEN - VALIDATION REQUIRED |
| ASM-008 | ASSUMPTION REQUIRING VALIDATION | RawNet2 can serve the fast path and AASIST the deep path within the configured stride on declared target hardware. | FR-SPOOF-001, MLR-LAT-001, NFR-PERF-002 | Benchmarks for preprocessing and each model, including p50/p95, queue behavior, memory, and hardware/configuration. | N, O, Y | OPEN - VALIDATION REQUIRED |
| ASM-009 | ASSUMPTION REQUIRING VALIDATION | Approximately four-second windows with approximately one-second stride provide a useful evidence/latency balance. | FR-QUAL-003, NFR-PERF-001, MLR-LAT-001 | Controlled experiment comparing window/stride settings, measured detector behavior, and end-to-end intervention latency. | L, O, Y | OPEN - VALIDATION REQUIRED |
| ASM-010 | ASSUMPTION REQUIRING VALIDATION | Quality features can distinguish insufficient evidence without systematically penalizing supported languages, voices, devices, or channels. | FR-QUAL-001, FR-QUAL-002, MLR-ROB-001, MLR-LANG-001 | Quality-label protocol, slice analysis, threshold rationale, and failure/abstention evaluation. | L, O | OPEN - VALIDATION REQUIRED |
| ASM-011 | ASSUMPTION REQUIRING VALIDATION | English, Hindi, and Kannada are feasible prototype evaluation slices. | MLR-LANG-001 | Licensed natural/synthetic samples, adequate counts, annotation/provenance, and per-language results. | K, O | OPEN - VALIDATION REQUIRED |
| ASM-012 | ASSUMPTION REQUIRING VALIDATION | Native Windows development can run compatible PostgreSQL and LiveKit binaries plus Node and Python services without Docker. | NFR-COMP-001 | Version-verified native setup, clean-machine runbook, health checks, and restart verification. | D, X | OPEN - VALIDATION REQUIRED |
| ASM-013 | ASSUMPTION REQUIRING VALIDATION | PostgreSQL-backed or single-process coordination is sufficient for the SIH single-node call/state/event load without Redis. | FR-RISK-004, NFR-REL-001 | Architecture decision, concurrency/load evidence, restart/recovery tests, and declared single-node capacity. | B, H, Y | OPEN - VALIDATION REQUIRED |
| ASM-014 | ASSUMPTION REQUIRING VALIDATION | Selected encryption and key-management mechanisms can protect voiceprints and support rotation/deletion on the target deployment. | FR-ENR-004, FR-ENR-005, NFR-SEC-003 | Threat model, key hierarchy/rotation design, cryptographic implementation review, deletion and recovery tests. | B, F, U | OPEN - VALIDATION REQUIRED |
| ASM-015 | ASSUMPTION REQUIRING VALIDATION | Independent step-up can be demonstrated without a real bank-core or external provider. | FR-INT-003, FR-INT-005 | Approved sample workflow and contract/E2E evidence that caller voice cannot release the hold. | I, Q, T | OPEN - VALIDATION REQUIRED |
| ASM-016 | ASSUMPTION REQUIRING VALIDATION | Retained compact evidence is sufficient for audit and incident reconstruction without full call audio. | FR-AUD-001, FR-AUD-003, NFR-PRIV-002 | Four-scenario audit reconstruction, retention scan, and analyst review. | Q, T, U | OPEN - VALIDATION REQUIRED |
| ASM-017 | ASSUMPTION REQUIRING VALIDATION | The official SIH26104 wording, organization attribution, and current submission rules are accurately reproduced in the provided files. | Source register and submission wording | Separately obtained official SIH problem statement/rules with URL or immutable copy, title/ID match, and provenance record. | Z | OPEN - VALIDATION REQUIRED |
| ASM-018 | ASSUMPTION REQUIRING VALIDATION | “Privacy- and DPDP-aligned design” remains acceptable wording for the implemented data flows. | NFR-PRIV-003 | Deployment-specific data-flow review and qualified legal review; until then no compliance claim. | U, Z | OPEN - VALIDATION REQUIRED |

## 2. Engineering decisions fixed for later validation

| ID | Classification | Decision | Rationale | Revisit trigger |
|---|---|---|---|---|
| DEC-A-001 | ENGINEERING DECISION | Use SWAR as the product name; retain VIGIL only in source titles/hashes. | Latest user instruction and root contract have higher authority. | Explicit user rename. |
| DEC-A-002 | ENGINEERING DECISION | Implement the SIH media path with LiveKit/WebRTC only. | Matches the frozen architecture and controlled-call boundary. | Approved architecture change after SIH gate. |
| DEC-A-003 | ENGINEERING DECISION | Treat SIP/contact-centre adapters as future integrations. | Prevents the prototype from expanding into unverified telephony scope. | Separate enterprise integration contract. |
| DEC-A-004 | ENGINEERING DECISION | Do not require or introduce Redis for the SIH single-node build. | Root contract approves PostgreSQL-backed or single-process alternatives. | Measured load proves a need and a higher-authority decision approves it. |
| DEC-A-005 | ENGINEERING DECISION | Expose only `VERIFIED`, `UNVERIFIED`, `HIGH_RISK`, and `CRITICAL` as risk states. | These are the frozen user-facing semantics. | Explicit risk-contract change with migration impact. |
| DEC-A-006 | ENGINEERING DECISION | Represent unreliable ML input as `INSUFFICIENT_EVIDENCE`, separate from the four-state business matrix. | Preserves quality-aware abstention without inventing a fifth risk state. | Machine-readable contract design in Phase J may refine fields, not semantics. |
| DEC-A-007 | ENGINEERING DECISION | Require measurable results but set no numeric detector, latency, scale, or accessibility target in Phase A. | No valid benchmark or product threshold exists yet. | O/Y results and authorized acceptance target. |

## 3. Future enterprise integrations

| ID | Classification | Item | Entry evidence |
|---|---|---|---|
| FUT-001 | FUTURE ENTERPRISE INTEGRATION | SIP/contact-centre media adapter. | Approved contract, authoritative track-binding design, compatible LiveKit/SIP evidence, security review. |
| FUT-002 | FUTURE ENTERPRISE INTEGRATION | Real bank-core action hold/release. | Customer contract, sandbox, authorization model, idempotency contract, legal/security review. |
| FUT-003 | FUTURE ENTERPRISE INTEGRATION | External passkey, official-callback, fraud-desk, supervisor, or branch verification. | Provider/customer contracts and transaction-binding tests. |
| FUT-004 | FUTURE ENTERPRISE INTEGRATION | Endpoint inference for server-blind encryption. | New privacy/threat architecture and validated device performance. |
| FUT-005 | FUTURE ENTERPRISE INTEGRATION | Broader Indic-language or regional production claim. | Licensed representative data and approved per-language evaluation. |
| FUT-006 | FUTURE ENTERPRISE INTEGRATION | Optional forensic audio recording. | Explicit policy and legal basis/consent, encryption, short retention, audited access, and user authorization changing the default contract. |

## 4. Closure rule

Closing an assumption requires replacing `OPEN - VALIDATION REQUIRED` with a dated evidence link, reviewer/authority, result, and affected requirement/acceptance updates. A failed validation must not be hidden; it triggers the smallest contract or implementation correction permitted by the active phase.
