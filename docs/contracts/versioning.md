# Contract versioning and compatibility

Status: ENGINEERING DECISION  
Contract version: 1.0.0  
Frozen: 2026-08-29

SWAR public REST uses the `/api/v1` base path. WebSocket, ML-control, and ML-evidence payloads carry `schemaVersion`. A producer may add an optional field only in a backward-compatible minor release. Removing or renaming a field, changing enum meaning, changing score direction, making an optional field required, or changing authentication requires a new major version and a parallel migration window.

Consumers must reject unsupported major versions and unknown enum values instead of guessing. Numeric sequences and window offsets cross JSON boundaries as decimal strings to avoid precision loss. `calibratedScore` is absent until calibration exists and, when present, requires `calibrationVersion`. Raw logits remain `rawScore`; the contract never implies probability semantics.

Idempotent mutations require `Idempotency-Key`. Evidence requires the key to equal `eventId`. A replay with the same key and equivalent content returns the prior result; the same key with different content is a conflict. WebSocket clients deduplicate by `eventId`, acknowledge processed events, and resubscribe with `afterEventId`. `BOUNDARY_EXCEEDED` means the bounded in-memory replay window cannot satisfy the requested resume point and the client must reconcile through REST.

REST consumers use each operation's `x-swar-error-codes` extension as the stable error-code inventory. Adding a recoverable code is backward compatible; removing or changing the meaning of a code requires a major-version review. Provider/database messages are never part of this contract.

Checked-in OpenAPI/AsyncAPI and JSON Schema files are authoritative. Contract tests validate syntax, references, discriminated evidence semantics, enums, and controller-to-snapshot path drift.
