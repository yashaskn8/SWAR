# SWAR domain model

Version: 1.0.0  
Frozen: 2026-08-28  
Status: Phase E contract

## Authority and boundaries

This document translates the approved requirements and architecture into the persistent vocabulary owned by NestJS/PostgreSQL. The independent ML service receives an authorized analysis grant and returns transient, versioned evidence; it does not own these records or access PostgreSQL. No entity stores call audio, enrollment audio, PCM, waveform data, tensors, or a reusable plaintext embedding.

Every tenant-owned repository operation must accept an authenticated `organization_id` separately from an object ID and use both in the query. An object ID is never sufficient authorization. `Organization`, global login `User`, and governed `ModelVersion` are the only non-tenant roots; every other model carries `organizationId` and a composite tenant/id key.

## Glossary

| Term | Exact meaning |
|---|---|
| Trusted speaker | An organization-scoped subject whom an authorized operator expects to speak in a controlled call. The record is not proof that the current caller is that person. |
| Voiceprint | A versioned, encrypted ECAPA-derived embedding plus encryption/model metadata, created under active consent. It is sensitive biometric-like data, not plaintext audio and not an authentication credential by itself. |
| Call | A backend-authorized, enterprise-controlled LiveKit/WebRTC security session bound to one organization, room, policy version, and optional expected trusted speaker. It is not a GSM/carrier call. |
| Participant | A backend-authorized logical actor in a call, identified for control decisions by `livekitIdentity` and `authorizedIdentity`; `displayName` is presentation-only and never authoritative. |
| Media track | Metadata for one published LiveKit track SID belonging to one authorized participant. It contains no media bytes. |
| Track binding | A revisioned authorization joining organization, call, participant, and media track. Only the active authorized revision may be analyzed. |
| Analysis session | A short-lived backend authorization for the ML subscriber to process one exact call/binding, optionally against one voiceprint. It owns no durable audio. |
| Evidence | An immutable, idempotent, ordered result or insufficiency/error fact for one analysis window and revision, with model and score semantics where applicable. Evidence is not a business risk decision. |
| Risk event | An immutable NestJS decision transition linking accepted evidence to an approved risk state and immutable policy/threshold/schema versions. |
| Intervention | A server-side warning, hold, step-up/callback requirement, or call action created from a risk event. Its state survives client/dashboard disconnection. |
| Alert | An idempotent delivery record for a versioned security event. It contains routing metadata, not conversation content. |
| Audit log | Append-only, tenant-scoped, non-sensitive metadata recording who attempted which protected operation, its outcome, correlation ID, and target. |

## Ownership and invariants

- NestJS owns all persisted models and validates transitions before a transaction writes them.
- PostgreSQL enforces UUID types, tenant-aware uniqueness, foreign keys, and non-null requirements. Phase F adds database checks and partial indexes that Prisma schema language cannot express.
- UUIDv7 and UTC timestamp decisions are frozen in [ADR-006](../decisions/ADR-006-uuidv7-identifiers.md). Explicit scoped sequence and revision fields, not arrival time or UUID order, determine evidence chronology.
- Published model versions, active risk policies, evidence events, risk events, interventions, and audit logs are immutable except for their documented lifecycle fields.
- Scores are stored only with score name, direction, checkpoint/model identity, readiness, and calibration version when calibration applies. A raw score is not called a probability.
- A policy/model/calibration version can change between calls or evidence events. An existing event's snapshot fields never change silently.

## Identity, tenancy, and sessions

### Organization

Tenant root. `slug` is globally unique; deletion is an explicit audited workflow, never an unscoped cascade.

### User

Global login identity. One user can hold separate memberships and trusted-speaker records in multiple organizations. Authentication secrets are hashed; deletion is lifecycle state plus removal/anonymization rules implemented later.

### OrganizationMembership

Joins a user to exactly one organization and owns tenant authorization status. The same user has at most one membership per organization.

### OrganizationMembershipRole

Assigns one or more explicit roles to a membership. The tenant-aware unique key prevents a duplicate role assignment.

### Device

An organization-membership-scoped client registration. `devicePublicId` is an opaque server-recognized identifier, not a hardware secret.

### RefreshSession

A rotated/revocable refresh-token session bound to one membership and device. Only a token hash is stored. `familyId` supports replay-family revocation.

## Enrollment and model governance

### TrustedSpeaker

Organization-scoped enrollment subject. A global user may map to a separate trusted-speaker record per organization; consent, voiceprint, and deletion never cross that boundary.

### EnrollmentConsent

Immutable grant facts plus lifecycle timestamps for one purpose and notice version. Revocation or expiry prevents new enrollment/use and triggers voiceprint/session handling; a later re-enrollment creates a new consent record.

### Voiceprint

Stores only nullable encrypted embedding ciphertext plus encryption algorithm/key version, format, sample count, consent, model version, and lifecycle metadata. On deletion, ciphertext is cleared while minimal audit/reference metadata remains. Plaintext embeddings and samples are transient.

### ModelVersion

Global governed registry entry for a specific capability and checkpoint hash, including source, license, expected input format, score semantics, optional calibration version, and readiness lifecycle. Registration is not scientific validation.

## Controlled call and media authorization

### Call

Tenant-owned controlled-call aggregate. It freezes the selected policy ID/version and optional expected trusted speaker for the session. `protectedActionReference` is an opaque enterprise reference, never bank-core data.

### CallParticipant

Logical authorized participant. Backend-issued `livekitIdentity` and `authorizedIdentity` drive binding; `displayName` cannot establish identity. Optional membership/trusted-speaker links are backend selected.

### MediaTrack

Metadata for a participant-owned published track SID. Reconnection/republishing creates a new track record rather than overwriting the prior SID.

### TrackBinding

Revisioned server authorization for the exact participant/track in a call. A new track SID creates a higher binding revision and supersedes the prior active binding transactionally. Replayed or cross-tenant bindings are rejected.

### AnalysisSession

Short-lived authorization for one call and binding revision. It may reference one active voiceprint. Voiceprint revocation moves active sessions to `DEGRADED`/`REVOKED`, prevents further identity comparison, clears transient ML material, and continues only quality/spoof monitoring if policy authorizes it.

## Evidence, risk, and intervention

### RiskPolicy

Organization-scoped immutable policy version. `policyDocument` holds validated policy configuration; Phase Q defines calibrated provisional settings and activation rules. Calls and risk events snapshot the selected version.

### EvidenceEvent

Immutable FAST, DEEP, identity, quality, insufficient-evidence, or pipeline-error fact. Tenant/idempotency and window/type/revision uniqueness make retries deterministic. `eventSequence` orders accepted arrivals; `windowSequence` and `revision` order analysis semantics. A later DEEP or corrected event links through `supersedesEvidenceId`; stale or duplicate events remain classified and cannot silently rewrite history.

### RiskAssessment

Immutable engineering, shadow, calibrated-blocked, or production-eligible evaluation of a deterministic accepted evidence set. It records the four matrix outcomes or internal `INSUFFICIENT_EVIDENCE`, effective temporal state, evidence/policy/calibration trace, proposed interventions, explicit production-eligibility/suppression result, and stable activation-blocker codes. A suppressed assessment cannot create a production transition, intervention, or security event. Engineering `DEMO` transitions/outbox records are permitted only with their non-production mode tag; `SHADOW` creates no action.

### RiskAssessmentEvidence

Tenant-scoped join proving the exact evidence set used by an immutable assessment. It permits replay and out-of-order determinism checks without copying raw scores into the assessment.

### RiskEvent

Immutable transition created only by the backend risk engine. It links its source assessment and accepted evidence through tenant-scoped relations, stores prior/current approved states, snapshots policy/threshold/schema versions, and records `DEMO`, `SHADOW`, or `PRODUCTION` control mode. It never treats insufficient audio as `CRITICAL` by itself. Production mode requires the independent O/P/Q promotion gates.

### RiskEventEvidence

Tenant-scoped join proving exactly which immutable evidence informed a risk event. Duplicate links are prohibited.

### Intervention

Server-side action created idempotently from a risk event. It records control mode plus bounded execution attempt, next-attempt, and failure state. Engineering execution is limited to the explicit `DEMO` adapter; `SHADOW` creates no action. A production hold is released only by an authorized independent verification/policy transition, never by caller voice alone or client disconnect.

### VerificationChallenge

An attempt for step-up or official callback verification tied to one intervention. It stores method/result codes and lifecycle metadata, not OTPs, answers, or private payloads.

### Alert

Durable, idempotent delivery/outbox state for versioned WebSocket security-event publication. It carries a stable external event ID, control mode, bounded retry state, delivery timestamp, and tenant-authorized acknowledgement membership/timestamp. Failure remains visible and does not change the underlying risk/intervention state.

### AuditLog

Append-only record for protected state changes. Polymorphic `targetType`/`targetId` are deliberately not foreign keys; the service validates the target tenant before insert. Metadata is allow-listed and may not contain audio, embeddings, tokens, passwords, secrets, or conversation text.

## Relationship and deletion policy

| Parent/child | Cardinality and delete behavior |
|---|---|
| Organization -> tenant models | One-to-many; `RESTRICT`. Tenant erasure is an explicit, authorized, audited workflow. |
| User -> memberships/trusted speakers | One-to-many; `RESTRICT`. Multi-organization records remain independent. |
| Membership -> assigned roles | One-to-many; join rows may cascade only when the membership row is explicitly deleted. |
| Consent -> voiceprints | One-to-many; `RESTRICT`. Revoke first, clear voiceprint ciphertext, retain minimal consent/audit evidence. |
| ModelVersion -> voiceprints/evidence | One-to-many; `RESTRICT`. Retire, never rewrite referenced versions. |
| Call -> participants/tracks/bindings/sessions/events/actions | One-to-many; `RESTRICT`. End state is retained according to security policy. |
| Evidence -> risk links | Many-to-many through `RiskEventEvidence`; link cleanup may cascade from an explicitly deleted risk event, while source evidence is restricted. |
| RiskEvent -> interventions/alerts | One-to-many; `RESTRICT`. Delivery/action history must remain reconstructable. |

Only membership-role and risk-event-evidence join rows use narrowly scoped cascade semantics. Lifecycle entities otherwise use status transitions; soft deletion is used only where identity/biometric revocation or account erasure requires preserved proof without retaining deleted protected material.

## Edge-case decisions

- Multi-organization employee: global `User`, separate `OrganizationMembership`, `TrustedSpeaker`, consent, and voiceprint per organization; no cross-tenant reuse.
- Voiceprint revoked during a call: consent/voiceprint revoke atomically, the identity path stops, analysis degrades or revokes, buffers clear, and prior evidence remains versioned for audit. No unknown caller becomes verified.
- Participant reconnect/new track SID: create a new `MediaTrack` and `TrackBinding.revision`; supersede the prior binding and reject later evidence against it.
- FAST/DEEP out of order or retried: tenant idempotency keys deduplicate transport retries; window/type/revision uniqueness orders semantics; a late accepted revision can create a new risk event but never edits an old one.
- A higher evidence revision atomically supersedes the previously accepted revision. A lower revision
  is stale, and a duplicate idempotency key replays the same committed assessment/outbox identity.
- Client reconnect/replay reads delivered outbox rows only within the authenticated organization and
  authorized call set. Acknowledgement is scoped by organization, membership, call, and event ID.
- Version changes: a call keeps its policy snapshot; each evidence and risk event keeps model/checkpoint/calibration/policy/threshold/schema snapshots. Activation affects later events/calls only under the owning contract.

## Requirements trace

| Requirement IDs | Entities/transitions and observable evidence |
|---|---|
| FR-AUTH-001..004, FR-AUD-001..003 | `User`, memberships/roles, `Device`, `RefreshSession`, `AuditLog`; tenant composite keys, session lifecycle, audit records. |
| FR-CALL-001..006 | `Call`, `CallParticipant`, `MediaTrack`, `TrackBinding`, `AnalysisSession`; authoritative identity/track revision and idempotency constraints. |
| FR-ENR-001..005, NFR-PRIV-001..002 | `TrustedSpeaker`, `EnrollmentConsent`, `Voiceprint`, `ModelVersion`; consent/voiceprint lifecycle and ciphertext deletion evidence. |
| FR-ID-001..004, FR-SPOOF-001..004, FR-QUAL-001..004, MLR-GOV-001..002 | `ModelVersion`, `EvidenceEvent`; score semantics, readiness/reason, model/checkpoint/calibration/window/latency fields. |
| FR-RISK-001..006 | `RiskPolicy`, `EvidenceEvent`, `RiskEvent`, `RiskEventEvidence`; immutable ordered transitions and version snapshots. |
| FR-INT-001..005 | `Intervention`, `VerificationChallenge`, `Alert`; hold/step-up/callback and bounded delivery lifecycles. Real bank-core connectors remain future scope. |
| FR-API-002..004, FR-DASH-001..002 | Aggregate IDs and query indexes support later contract/API work; no frontend or API is implemented in Phase E. |
| NFR-SEC-001..003, NFR-REL-001..002 | Tenant FKs, idempotency/sequence fields, expiry/status fields, explicit degraded/error states, minimal audit metadata. |
| MLR-SAFE-001 | Scenario walk in [state-machines.md](state-machines.md) traces the four orchestration outcomes without claiming model performance. |

## VALIDATION REQUIRED

- Phase F must implement and exercise PostgreSQL check/partial-unique constraints identified in the index plan.
- Phases K-N must verify actual checkpoint sources/licenses/formats and populate governed model records; no checkpoint is approved by this schema.
- Phase O must validate score semantics, calibration versions, thresholds, and measured metrics before policy activation.
- The organization-approved retention schedule and legal review remain required; triggers are frozen, durations are not invented.
- Future bank-core identifiers/connectors require a separate enterprise contract and authorization.
