# Phase P secure ML serving

Status: `IMPLEMENTED_NOT_PROMOTED`

Production activation: `BLOCKED_BY_PHASE_O`

This phase implements the private engineering path from a NestJS-authorized analysis session to a
restricted FastAPI/LiveKit media subscriber and back to the NestJS evidence boundary. It does not
implement Phase Q risk state, intervention policy, transaction action, or frontend behavior.

## Trust and binding boundary

NestJS derives the organization, call, analysis session, active track-binding revision, LiveKit
room, server-authorized caller participant identity, and exact microphone track SID from
tenant-scoped persistence. It issues a short-lived `ML_SUBSCRIBER` LiveKit grant and sends the
complete tuple to FastAPI through the v2 analysis-control contract.

Every control request uses the dedicated backend-to-ML secret plus an HMAC-SHA256 signature over
method, path, timestamp, nonce, idempotency key, and body hash. FastAPI rejects the wrong service,
secret, signature, expired timestamp, reused nonce, or conflicting idempotency/binding tuple.
LiveKit auto-subscription is disabled. The ML subscriber accepts only the authorized room,
participant identity, exact track SID, and an audio publication; substituted audio publications are
unsubscribed. Track arrival, model operations, callbacks, and reconnect attempts are bounded.

FastAPI has no Prisma, PostgreSQL driver, application repository, or tenant-policy dependency.
NestJS remains the only component that authorizes tenants, persists evidence, and can eventually
apply Phase Q policy.

## Evidence modes and activation

Each analysis session and persisted evidence event carries one authoritative mode:

- `SIMULATED` is non-scientific development evidence. Events are labelled
  `SIMULATED_NON_SCIENTIFIC_EVIDENCE` and `DEMO_ONLY_NO_PRODUCTION_ACTION`.
- `SHADOW` is technical real-model evidence labelled `SHADOW_NO_ACTION`; it cannot trigger an
  action.
- `CALIBRATED` is reserved for a future Phase O-promoted calibration package and is the only mode
  that may eventually feed production controls.

Mode substitution is rejected at FastAPI session creation and NestJS evidence ingestion. The
current Phase O artifact is `BLOCKED_VALIDATION_REQUIRED`, has no calibration package or promotion
approval, and therefore `/health/ready` returns HTTP 503 for production readiness. Missing or
invalid model, registry, preprocessing, or checkpoint checksums also keep readiness blocked. No
Phase P code converts raw scores to probabilities or chooses risk/intervention outcomes.

## Bounded processing and delivery

Each call has bounded frame, normalized-window, and evidence queues. The explicit overload policy
drops and clears the oldest item so the live path favors current media and never grows without
bound. Queue depth and reason-coded drops are exported as low-cardinality telemetry.

LiveKit reconnects, backend control requests, model work, and evidence callbacks use configured
timeouts, bounded retry counts, and linear bounded backoff. Evidence IDs are deterministic per
session/window/type/revision/mode; the callback uses that event ID as its idempotency key. Duplicate
delivery returns the cached acceptance, terminal-session evidence is persisted as `STALE`, and
evidence generated after session close is discarded. Callback failure records only a bounded event
ID and stable error code, never the evidence payload.

## Privacy and shutdown

Audio frames use mutable byte buffers. Queue eviction, preprocessing completion, cancellation,
timeout, exception, disconnect, stop, and process shutdown clear frames, windows, tensors or model
inputs, transient reference embeddings, queues, and in-memory idempotency caches. Full call audio is
not written to disk or PostgreSQL. Telemetry labels contain only fixed categories; audio, embeddings,
tokens, tenant/call identifiers, and private call content are excluded.

## Remaining activation blockers

Production activation requires Phase O to provide an approved governed manifest, measured
exact-version scientific results, fitted and verified calibration/operating points, complete OOD and
robustness evidence, target-hardware observations, and authorized promotion. Model/checkpoint,
registry, preprocessing, and calibration checksums must then validate under `CALIBRATED` plus the
real provider. Phase Q remains `NOT_STARTED` and may not treat simulated or shadow evidence as an
actionable production signal.
