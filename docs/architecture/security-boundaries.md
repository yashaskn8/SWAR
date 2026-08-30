# SWAR Security and Privacy Boundaries

Status: FROZEN - Phase B  
Date: 2026-08-28

## Trust boundaries

| Boundary | Untrusted side | Trusted side | Required control | Failure consequence |
|---|---|---|---|---|
| User/client -> NestJS | User input and modified client | Public API/WebSocket adapter | TLS, access/refresh session validation, DTO validation, RBAC, organization scope, rate limits, idempotency | Reject with stable error; no state mutation. |
| User/client -> LiveKit | Client media and participant behavior | Enterprise LiveKit room policy | Backend-issued short-lived least-privilege participant JWT, server-authorized identity, room scope | Reject/leave participant; do not analyze unknown media. |
| LiveKit -> NestJS | Network-delivered lifecycle event | Verified webhook adapter | LiveKit signature/authentication, timestamp/replay validation, schema validation, idempotency | Ignore/reject event; preserve previous binding and mark protection degraded if necessary. |
| NestJS -> ML | Analysis command and binding | Private FastAPI adapter | Private network, TLS, backend service identity, short-lived analysis grant, exact binding, expiry and replay protection | Reject session; no media join. |
| ML -> LiveKit | Service participant requesting media | LiveKit room | Backend-issued subscribe-only participant JWT and exact application-level participant/track allowlist | Leave/reject wrong track; emit binding error, not evidence. |
| ML -> NestJS | Evidence/error event | Evidence ingestion adapter | TLS, ML service identity, session/binding/sequence/revision/idempotency validation | Reject/ignore invalid event; audit non-sensitive reason. |
| NestJS -> PostgreSQL | Backend query/transaction | Tenant data store | DB service credential, parameterized repository interface, organization scope, least privilege, transactions | Fail closed for mutations; active protection cannot be silently cleared. |
| NestJS -> protected action/verifier | Hold/release/challenge request | Contracted or SIH sample adapter | Service authentication, call/action/challenge binding, expiry, idempotency | Retain hold or require trusted fallback. |
| NestJS -> WebSocket subscriber | Network client requesting events/replay/ack | Durable tenant security-event outbox | One bounded bearer credential, active session/membership revalidation on subscribe/publish/ack, organization/call authorization, strict stable event ID, connection/rate limits, and bounded replay | Disconnect revoked clients; reject ambiguous credentials, excess connections, invalid cursors, or another tenant/call event without publishing or acknowledging it. |
| Operator -> services | Human/operator command | Native service management | OS/service identity, least privilege, audited access, secret separation | Reject unauthorized access; no content logging. |

## Credential inventory

| Credential/secret | Held by | Lifetime/scope | Never exposed to |
|---|---|---|---|
| User password hash | NestJS/PostgreSQL as Argon2id hash | Until password lifecycle change | Clients, ML, LiveKit, logs. |
| Access token | User client and NestJS verifier | Short-lived user/tenant/audience scope | ML, PostgreSQL logs, LiveKit API surface. |
| Refresh session secret/token | Secure client storage plus revocable server record | Rotated/revocable device session | LiveKit, ML, logs, source. |
| LiveKit API key/secret | NestJS/infrastructure secret boundary | Server-only deployment credential | Android, React, ML subscriber token payload, logs, repository. |
| LiveKit participant JWT | Android or ML participant | Short-lived room/identity/permission scope | Database persistence, logs, unrelated rooms. |
| Backend-ML service credential | NestJS and ML private adapters | Service/audience scoped; rotatable | Frontends, LiveKit participants, logs. |
| Database credential | NestJS service only | Least-privilege database role | Frontend, ML, LiveKit, repository source. |
| JWT signing/private material | NestJS secret boundary | Rotatable server-only key | Clients, ML unless public verification key is explicitly needed, logs. |
| Voiceprint encryption key | Approved NestJS key boundary | Key/version/tenant policy; rotatable | PostgreSQL plaintext fields, ML after ephemeral operation, clients, logs. |
| Model-download credential if required | Governed ML setup boundary | Download-only, never runtime client data | Frontends, NestJS logs, repository. |

## Audio and embedding lifetime

| Boundary/location | Raw audio allowed? | Embedding allowed? | Lifetime and clearing rule |
|---|---|---|---|
| Android/LiveKit media runtime | Yes, for the active authorized call | No trusted voiceprint | Media-session lifetime according to client/LiveKit runtime; SWAR does not enable persistent recording by default. |
| ML PCM/window memory | Yes, only bound caller frames | Incoming/enrollment embeddings transiently | Bounded ring/window/session; clear on stop, call end, timeout, disconnect, cancellation, and error. |
| NestJS request memory | Enrollment sample may transit only through the bounded authorized enrollment request path; call audio does not | Plaintext result only for immediate encryption/comparison orchestration where required | Minimum request/operation lifetime; zero/release references after use; no logging. |
| PostgreSQL | No | Ciphertext voiceprint only | Consent/retention-bound until revocation/deletion; non-sensitive lifecycle audit remains. |
| Logs, metrics, dashboard, WebSocket | No | No | Only IDs, versions, reason codes, state and non-sensitive timing. |

## Red-team architecture review

| Attack | Architecture control | Required later proof |
|---|---|---|
| Client supplies trusted identity | Trusted speaker comes from tenant-scoped backend call/enrollment context; client identity input is not a risk authority. | API/service negative test. |
| Client uploads clean substitute audio | ML subscribes to the exact LiveKit caller track heard by the customer; no client upload analysis path exists. | Media-binding E2E test. |
| Caller publishes multiple tracks | Analysis requires one explicit backend binding; extra tracks are ignored/quarantined and create no evidence. | Multi-track test. |
| Wrong tenant/participant/track | Organization, call, room, participant and track must all match analysis grant and current binding. | Cross-tenant/wrong-track tests. |
| Forged/replayed webhook or evidence | Signature/service authentication plus timestamp, session, sequence, revision and idempotency checks. | Injection/replay tests. |
| Raw audio persistence | No persistent raw-audio entity or flow; allowed memory locations and clearing rules are explicit. | Storage/log scan and lifecycle test. |
| Embedding disclosure | Encrypt before durable storage; no plaintext in logs/events; deletion/revocation supported. | Encryption/access/deletion tests. |
| Threshold probing | Customer event exposes state/reason guidance, not detailed raw scores/thresholds; rate limits apply. | API/UI review and rate-limit test. |
| Fixture/shadow evidence activates production | Every evidence/assessment/event/action carries a mode and production startup/decision gates validate O/P/Q promotion plus calibration provenance. | Production-mode and headless transaction tests. |
| Dashboard/client compromise | Backend hold and policy remain authoritative; clients cannot release or rewrite state. | Modified-client/disconnect E2E test. |

## Privacy statements

- Voice audio and embeddings are sensitive biometric-like data.
- Consent precedes enrollment; deletion and revocation are first-class flows.
- Full call audio is not persisted by default.
- Evidence metadata is retained only according to tenant policy and without conversation content.
- The permitted claim is “privacy- and DPDP-aligned design”; formal compliance remains `VALIDATION REQUIRED` pending legal and deployment review.
