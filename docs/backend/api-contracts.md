# Backend API and event contracts

Status: FROZEN - Phase J  
Contract version: 1.0.0  
Date: 2026-08-29

## 1. Adapter rule

Controllers and the WebSocket gateway validate transport data, derive the tenant from authenticated context or validate it against an authorized analysis binding, map safe response views, and call the Phase I application services. They do not implement model inference, thresholds, temporal risk, or frontend logic. Prisma records, room identities, encrypted voiceprints, and provider errors are not returned as public DTOs.

All REST errors use `{code, message, requestId, details?}`. User access uses a short-lived access JWT whose membership/session is reloaded from PostgreSQL. ML and independent-verifier callbacks have different service credentials. LiveKit uses its signed webhook body and `Authorization` signature. The global API limit values are configuration, not measured capacity claims.

## 2. REST interaction register

`Idem` means the retry identity. `Rate` names a configurable category. Permissions are evaluated after authentication and all resource queries remain tenant scoped.

| Method and path | Purpose | Authentication / permission | Validated request | Safe response | Errors and side effects | Idem | Rate |
|---|---|---|---|---|---|---|---|
| `POST /api/v1/auth/sessions` | Create session | Public credential check | Email, organization slug, enrolled device ID, password; no extra fields | Access/rotated refresh tokens plus IDs and roles | Generic authentication errors; session and audit write | Not applicable | SENSITIVE |
| `POST /api/v1/auth/sessions/refresh` | Rotate refresh family | Opaque refresh token | Refresh token only | Fresh access/refresh pair | Reuse revokes family; audit write | Token rotation semantics | SENSITIVE |
| `POST /api/v1/auth/sessions/revoke` | Revoke refresh session | Opaque refresh token | Refresh token only | `204` | Revocation and audit | Semantic replay | SENSITIVE |
| `POST /api/v1/calls` | Create controlled call | JWT / `call.create` | Versioned policy, optional expected speaker/protected action, bounded participants | Safe call view | Creates database aggregate and LiveKit room; provider failure is explicit | Header | MUTATION |
| `POST /api/v1/calls/{callId}/participants` | Authorize participant | JWT / `call.create` | Tenant call UUID, role and authoritative membership/trusted-speaker reference | Participant ID and short-lived join grant | Creates participant and grant; grant is never cached/logged | Header for participant identity; grant is freshly issued | MUTATION |
| `POST /api/v1/calls/{callId}/join-token` | Join authorized call | JWT / `call.read` | Call and participant UUIDs | Fresh short-lived join grant | Rejects non-owning membership | Not cached; fresh bounded grant | SENSITIVE |
| `POST /api/v1/calls/{callId}/end` | End and clean call | JWT / `call.end` | Call UUID | Safe call view | Revokes analysis/participants and closes room with explicit failed state | Header | MUTATION |
| `GET /api/v1/calls/active` | Active calls | JWT / `call.read` | Bounded cursor/limit | Safe paginated calls | Read only | Not applicable | QUERY |
| `GET /api/v1/calls/{callId}/risk-events` | Risk history | JWT / `risk-event.read` | Tenant call UUID, cursor/limit | State/reason/policy/threshold versions; bigint sequence as string | Read only; no raw model payload | Not applicable | QUERY |
| `POST /api/v1/trusted-speakers` | Create trusted-speaker record | JWT / `enrollment.manage` | Label and optional tenant-local references | ID, status, label | Database/audit write | Header | SENSITIVE |
| `POST /api/v1/trusted-speakers/{id}/consents` | Record consent | JWT / `enrollment.manage` | Explicit `true`, notice/purpose version, optional expiry | Consent lifecycle only | Consent/audit write | Header | SENSITIVE |
| `POST /api/v1/voice-enrollments` | Ephemeral enrollment | JWT / `enrollment.manage` | Bounded audio MIME/count/bytes and declared durations; matching active consent/model | Voiceprint/model IDs and status only | Buffers clear on success/error; encrypted persistence only | Header | SENSITIVE |
| `POST /api/v1/enrollment-consents/{id}/revoke` | Revoke consent | JWT / `enrollment.manage` | Reason code | Consent ID/status | Revokes dependent analysis; clears ML state | Header | SENSITIVE |
| `DELETE /api/v1/voiceprints/{id}` | Delete voiceprint | JWT / `voiceprint.delete` | Tenant voiceprint UUID | ID/status only | Ciphertext deletion plus dependent analysis revocation | Header | SENSITIVE |
| `GET /api/v1/risk-policies/active` | Read active policy | JWT / `risk-policy.read` | Policy key | Immutable policy/version/status | Read only | Not applicable | QUERY |
| `PUT /api/v1/risk-policies/{key}` | Add policy version | JWT / `risk-policy.manage` | Version/schema/document/activation choice | Immutable policy/version/status | Creates version and transactionally activates; no arbitrary threshold is supplied by SWAR | Header | SENSITIVE |
| `POST /api/v1/interventions/{id}/verification-challenges` | Request independent verification | JWT / `intervention.resolve` | Method | Challenge lifecycle and expiry | Persists bounded challenge; no result is self-asserted | Header | SENSITIVE |
| `POST /api/v1/internal/verifications/{id}/result` | Verification adapter callback | `swar-verifier` credential | Organization UUID, PASSED/FAILED, result code | Challenge ID/status/result code | Only pending non-expired challenge can complete | Persisted lifecycle replay | SENSITIVE |
| `POST /api/v1/interventions/{id}/release` | Release protected-action hold | JWT / `intervention.resolve` | Persisted challenge UUID | Intervention ID/status | Requires same-tenant, same-call, same-intervention, unexpired PASSED challenge | Header | SENSITIVE |
| `POST /api/v1/media/livekit/webhook` | Bind verified lifecycle | LiveKit signed webhook | Raw signed JSON before parsing/binding | `204` | Exact authoritative participant/track binding and analysis lifecycle | Verified event ID plus body hash | Not throttled here; signature/replay bounded |
| `POST /api/v1/internal/ml/evidence` | Ingest ML evidence | `swar-ml` credential | JSON Schema evidence; key equals event ID | Evidence/event IDs and ACCEPTED/STALE | Tenant/call/session/track verification before persistence; terminal evidence is STALE | Event ID | MUTATION |

## 3. WebSocket protocol

The standard `ws` endpoint is `/ws/security`. Non-browser clients may send `Authorization: Bearer`; browser-capable clients offer `swar.security.v1` and `swar.bearer.<JWT>` subprotocol tokens. Authentication failure closes with code `1008`. A client sends `security.subscribe` with call UUIDs and optional `afterEventId`; the server derives organization from the access principal and authorizes every call. No client-supplied organization is accepted.

`security.subscribed` returns the bounded replay count and `COMPLETE` or `BOUNDARY_EXCEEDED`, including oldest/latest available event IDs. Each outbound event uses a stable `eventId`; duplicates with equivalent bodies are suppressed, while conflicting reuse fails publishing. The client sends `security.ack`. Only inbound client messages are rate limited; security notifications are not discarded by an outbound rate limiter. Reconnect reconciliation after a boundary error uses the REST risk-event query.

## 4. Evidence semantics

`FAST` carries either IDENTITY or SPOOF_FAST ready evidence. `DEEP` carries SPOOF_DEEP. Ready evidence requires model name/version, checkpoint SHA-256, score name/direction, raw score, window/event sequences, timestamps, and measured processing latency when available. `calibratedScore` is optional and requires `calibrationVersion`.

`INSUFFICIENT_EVIDENCE` requires reason codes and forbids scores. `PIPELINE_ERROR` requires an error code and forbids scores. Poor audio does not imply CRITICAL. The ingestion adapter never converts raw logits to probability and never computes a risk state.

## 5. Limits and validation status

Upload sizes/counts, replay depth, subscription count, challenge expiry, and rate categories are configurable engineering safety bounds. They are not claims about measured throughput, detector performance, or time-to-intervention.

VALIDATION REQUIRED:

- Phase P must implement the FastAPI endpoints and prove that runtime types are generated or validated from the ML schemas.
- Phase P must validate actual audio decoding, format, duration, and clearing; Phase J validates transport declarations and byte/MIME bounds only.
- The independent verifier endpoint is an adapter boundary. A real bank-core/callback provider, its credential issuance, assurance level, and contract remain a FUTURE ENTERPRISE INTEGRATION.
- Phase Q must connect accepted evidence to temporal policy, interventions, and all four event types; Phase J only transports versioned events.
- Phase Q must freeze and enforce the semantic schema for risk-policy documents before any document can drive a risk decision; Phase J preserves immutable versioning and authorization but does not invent thresholds.
- Replay is single-process bounded memory for the SIH build. Multi-node/durable replay requires a future architecture decision.
