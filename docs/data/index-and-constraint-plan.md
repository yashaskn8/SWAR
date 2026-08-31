# SWAR index and constraint plan

Version: 1.0.0  
Frozen: 2026-08-28  
Implementation target: native PostgreSQL through Phase F Prisma migrations

Phase E defined this plan and validated the Prisma schema without creating a migration or touching a database. Phase F implements the `DATABASE CHECK/PARTIAL INDEX` rows in the reviewed `20260828000000_initial_swar_schema` SQL migration and native PostgreSQL integration tests.

## Constraint principles

- Every tenant-owned table contains `organization_id` and has unique `(organization_id, id)` so child relations can reference tenant plus object ID.
- Repository/service queries provide `organization_id` from authenticated context; they never infer it from request objects or fetch by ID alone.
- Foreign-key delete behavior is `RESTRICT` except two pure join relations: membership-role rows and risk-event-evidence links may cascade from their explicitly deleted parent.
- User-facing/model states are PostgreSQL enums through Prisma. Service transition guards remain mandatory because an enum alone cannot enforce legal edges.
- Idempotency keys are opaque, validated, and unique inside one organization. Reuse with a different request fingerprint is an explicit conflict; Phase I adds the fingerprint/transaction behavior if required by its command contract.
- No index contains ciphertext, token hashes, raw/calibrated scores, policy JSON, audit JSON, labels, email, display names, or conversation content.

## Unique constraints

| Entity | Constraint | Purpose |
|---|---|---|
| `Organization` | `slug` | Stable tenant lookup. |
| `User` | `emailCanonical` | Global login identity; case/normalization rules are validated before persistence. |
| Every tenant model | `(organizationId, id)` | Tenant-aware referenced candidate key. |
| `OrganizationMembership` | `(organizationId, userId)` | One membership per user in each tenant; permits the same user in several tenants. |
| `OrganizationMembershipRole` | `(organizationId, membershipId, role)` | No duplicate role grants. |
| `Device` | `(organizationId, devicePublicId)` | No duplicate opaque device registration in a tenant. |
| `RefreshSession` | `tokenHash` | A refresh token hash identifies only one session. |
| `TrustedSpeaker` | `(organizationId, externalReference)`, `(organizationId, userId)` | Tenant-local external/user mapping; PostgreSQL permits multiple nulls. |
| `ModelVersion` | `(modelName, version, checkpointHashSha256)` | Immutable checkpoint identity. |
| `Call` | `(organizationId, roomName)`, `(organizationId, idempotencyKey)` | Room authorization and command replay protection. |
| `CallParticipant` | `(organizationId, callId, livekitIdentity)` | Backend-authorized logical participant identity. |
| `MediaTrack` | `(organizationId, trackSid)` | SID cannot bind to two tenant records. |
| `TrackBinding` | `(organizationId, callId, revision)`, `(organizationId, mediaTrackId)` | Ordered reconnect revisions and one authorization per track record. |
| `AnalysisSession` | `(organizationId, idempotencyKey)` | Analysis-create replay protection. |
| `RiskPolicy` | `(organizationId, policyKey, version)` | Immutable tenant policy versions. |
| `EvidenceEvent` | `(organizationId, idempotencyKey)`, `(organizationId, analysisSessionId, eventSequence)`, `(organizationId, analysisSessionId, windowSequence, evidenceType, revision)` | Transport replay, arrival order, and semantic revision identity. |
| `RiskAssessment` | `(organizationId, idempotencyKey)`, `(organizationId, analysisSessionId, evidenceSetHashSha256)` | One deterministic assessment per accepted evidence set and replay-safe callback handling. |
| `RiskAssessmentEvidence` | `(organizationId, riskAssessmentId, evidenceEventId)` | No duplicate assessment provenance links. |
| `RiskEvent` | `(organizationId, idempotencyKey)`, `(organizationId, callId, eventSequence)` | Immutable replay-safe temporal decisions. |
| `RiskEventEvidence` | `(organizationId, riskEventId, evidenceEventId)` | No duplicate provenance links. |
| `Intervention`, `VerificationChallenge`, `Alert` | `(organizationId, idempotencyKey)` | Action/delivery replay safety. |
| `VerificationChallenge` | `(organizationId, interventionId, attemptNumber)` | Ordered bounded verification attempts. |
| `AuditLog` | `(organizationId, idempotencyKey)` where key is non-null | Replay-safe audit insert with multiple allowed nulls. |

## Foreign keys and delete behavior

| Relation family | Tenant key | Delete behavior | Review rule |
|---|---|---|---|
| Organization to any tenant row | `organizationId -> Organization.id` | `RESTRICT` | Tenant deletion must enumerate, authorize, audit, and remove/de-identify by retention class. |
| Tenant parent to child | `(organizationId, parentId)` | `RESTRICT` | Composite FK prevents cross-tenant attachment even if an ID is disclosed. |
| Call participant/track/binding relations | `(organizationId, callId, entityId)` | `RESTRICT` | Triple candidate keys prove that participant and track belong to the same call. |
| Model version references | `modelVersionId -> ModelVersion.id` | `RESTRICT` | Retire referenced models; never delete/rewrite provenance. |
| Membership roles | `(organizationId, membershipId)` | `CASCADE` | Pure authorization join only; membership deletion is itself explicit/audited. |
| Risk event evidence | `(organizationId, riskEventId)` | `CASCADE`; evidence FK `RESTRICT` | Pure provenance join; evidence remains protected from parent cleanup. |
| Risk assessment evidence | `(organizationId, riskAssessmentId)` | `CASCADE`; evidence FK `RESTRICT` | Pure assessment provenance join; evidence remains protected from parent cleanup. |
| Exact evidence window lineage | `(organizationId, analysisSessionId, windowId)` | Nullable only for preserved v1 evidence | Efficient v2 window trace lookup without storing audio or content. |
| Intervention execution lease | `(status, executionLeaseExpiresAt, nextAttemptAt)` | Lease ID and expiry are both null or both present | Fences concurrent demo workers and recovers abandoned claims; dead-letter timestamp requires `FAILED`. |
| Audit target | no polymorphic FK | application tenant check | `targetType`/`targetId` are validated against the actor tenant before append. |

`Alert.interventionId`, `RiskEvent.analysisSessionId`, and other optional composite relations still include the non-null tenant key. Phase F integration tests must prove null optional IDs work and a non-null cross-tenant ID fails.

## Query indexes represented in Prisma

| Query path | Index prefix |
|---|---|
| Membership/RBAC checks | membership `(organizationId, status)`; role `(organizationId, role)`; reverse user `(userId, status)` |
| Device/session revocation | device `(organizationId, membershipId, status)`; session `(organizationId, membershipId, status)` and `(organizationId, familyId, status)`; expiry `(expiresAt, status)` |
| Enrollment use/revocation | trusted speaker `(organizationId, status)`; consent `(organizationId, trustedSpeakerId, status)`; voiceprint `(organizationId, trustedSpeakerId, status)` |
| Active/recent calls | call `(organizationId, status, createdAt)` and expected speaker/status |
| Participant/track binding | participant, media track, and binding `(organizationId, callId, status)`; participant authorized identity; track participant/status |
| Analysis expiry and call monitoring | analysis `(organizationId, callId, status)` and `(expiresAt, status)` |
| Policy lookup | `(organizationId, status, effectiveAt)` plus unique policy/version |
| Evidence timeline | `(organizationId, callId, observedAt)` and `(organizationId, analysisSessionId, windowSequence, acceptanceStatus)` |
| Risk timeline/dashboard | `(organizationId, callId, occurredAt)` and `(organizationId, state, occurredAt)` |
| Engineering/shadow assessment timeline | `(organizationId, callId, occurredAt)` and `(organizationId, analysisSessionId, maxWindowSequence)` |
| Active intervention/dashboard | `(organizationId, callId, status)` and `(organizationId, status, requiredAt)` |
| Alert delivery | `(organizationId, status, nextAttemptAt)` and call/created time |
| Audit lookup | organization/time, organization/target/time, organization/correlation |

Before adding an index in later phases, supply a real query plan/query frequency and verify it does not duplicate a unique-index prefix. Performance targets remain measured, not invented.

## Phase F database checks and partial indexes

| Type | Planned rule | Required test |
|---|---|---|
| DATABASE CHECK | Lifecycle timestamps are ordered and agree with terminal status (for example, `ended_at >= started_at`, revoked/deleted states carry their timestamps). | Valid boundary insert and invalid timestamp/status insert. |
| DATABASE CHECK | `Voiceprint.status = DELETED` requires `ciphertext IS NULL` and `deleted_at IS NOT NULL`; `ACTIVE` requires ciphertext, active consent reference, encryption metadata, and `activated_at`. Cross-row consent activity is rechecked transactionally. | Delete clears material; active row without material fails; concurrent revoke wins. |
| DATABASE CHECK | Counts, attempts, revisions, sequences, durations, and measured latencies are non-negative; `windowEndMs >= windowStartMs`. | Negative/bad-range inserts fail. No score range is assumed until semantics are verified. |
| DATABASE CHECK | SHA-256 snapshot fields contain 64 hexadecimal characters when present; required model evidence has complete model/score semantics. | Malformed hash/incomplete model evidence fails; insufficiency event without model is allowed. |
| DATABASE CHECK | Evidence type/readiness combinations are coherent: insufficiency/error has reason/error metadata and does not masquerade as calibrated model evidence. | Each valid evidence variant plus invalid mixed variant. |
| DATABASE CHECK | A risk event's state and prior state are approved enum values; transition reason and all policy/threshold/schema snapshots are non-empty. | Missing version/reason fails. |
| PARTIAL UNIQUE INDEX | At most one `ACTIVE` voiceprint per `(organization_id, trusted_speaker_id)` for the selected enrollment contract. | Concurrent activation yields one winner; re-enrollment revokes old first. |
| PARTIAL UNIQUE INDEX | At most one `ACTIVE` track binding per `(organization_id, call_id)` for the analyzed caller path. | Reconnect transaction supersedes old then activates new; two active rows fail. |
| PARTIAL UNIQUE INDEX | At most one `ACTIVE` risk policy per `(organization_id, policy_key)`. | Transactional activation retires prior version; concurrent activation conflict. |
| PARTIAL/QUERY INDEX | Pending alerts ordered by `next_attempt_at`; active expiring sessions/challenges ordered by expiry. | `EXPLAIN` uses intended index on representative measured data. |
| APPLICATION/TRANSACTION | Referenced call policy version equals immutable policy version; evidence snapshots match selected `ModelVersion`; analysis binding revision matches the referenced binding. | Mismatch commands fail and roll back audit/action writes. |
| APPLICATION/TRANSACTION | Status updates follow only [documented transitions](state-machines.md), with expected prior state/version. | Every legal edge succeeds; every unlisted edge and stale concurrent update fails. |

## Tenant-isolation integration matrix for Phase F

For every tenant-owned repository family, Phase F must prove:

1. same-tenant create/read/update transition succeeds;
2. same object ID with another `organizationId` returns not-found/denied without disclosure;
3. a child cannot reference a parent from another tenant at the database boundary;
4. list/timeline indexes begin with tenant scope and return no other tenant rows;
5. delete/revoke/update commands include tenant scope and expected state;
6. logs/errors contain stable codes and correlation IDs but no sensitive field values.

## Migration boundary

No migration exists in Phase E. Phase F now owns the committed initial migration, native PostgreSQL application/recovery verification, check/partial-index SQL, seed/fixture safety, and repository integration tests. Operational steps and forward-only recovery are frozen in the [migration runbook](migration-runbook.md). Later phases may add forward migrations but may not edit the applied initial migration or weaken this plan without an approved ADR and requirements trace update.
