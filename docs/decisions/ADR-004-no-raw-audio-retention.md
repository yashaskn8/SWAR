# ADR-004: No Persistent Raw Call Audio by Default

Status: Accepted  
Date: 2026-08-28  
Decision owners: SWAR privacy, security, backend, and ML architecture  
Requirements: FR-ENR-001 through FR-ENR-005; FR-QUAL-004; FR-AUD-002; NFR-PRIV-001 through NFR-PRIV-003

## Context

Call audio and speaker representations are sensitive biometric-like data. The detection pipeline needs decoded audio and transient embeddings, but the product can audit risk and intervention using compact versioned metadata. Persistent audio creates unnecessary consent, breach, retention, access, and legal exposure.

## Decision

Full call audio is not persisted by default. LiveKit transports active media and the ML process holds only bounded per-call PCM/windows/tensors/embeddings required for inference. Those buffers are cleared on normal stop, call/enrollment end, cancellation, timeout, disconnect, restart, and error.

Enrollment requires explicit purpose/version consent. Only encrypted tenant-scoped voiceprints with key/model/consent metadata are durable. Plaintext embeddings and enrollment samples are transient. Revocation and deletion make the voiceprint unusable/remove ciphertext while preserving a non-sensitive audit record.

NestJS/PostgreSQL retain compact evidence, risk, policy, action, and audit metadata without conversation content. Logs, metrics, WebSockets, and dashboards receive no raw audio or embeddings.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Persist every call for forensic review | Violates data minimization and is unnecessary for normal risk/audit reconstruction. |
| Persist feature arrays/spectrograms as harmless metadata | They may expose reusable voice information and are not approved durable evidence. |
| Store plaintext embeddings for simplicity | Creates direct voiceprint disclosure and prevents acceptable key lifecycle controls. |
| Perform all inference on device | Does not match the frozen authoritative server-track architecture and has unvalidated device/model constraints. |

## Consequences and trade-offs

- Positive: materially reduces retained biometric-like data and breach exposure.
- Positive: deletion/revocation and audit boundaries are explicit.
- Cost: model debugging and incident review cannot rely on replaying private production audio; consented governed test corpora and reproducible metadata are required.
- Cost: process restart loses the active audio context by design and creates a coverage gap/new analysis session.
- Future option: forensic recording requires an explicit user-approved contract change, legal basis/consent, encryption, short retention, audited access, and separate threat review.

## Compatibility

This ADR confines audio from ADR-001/002 to LiveKit and ML memory, lets ADR-003 NestJS retain compact evidence only, and requires ADR-005 deployment/logging to preserve these boundaries.

