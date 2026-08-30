# SWAR Headless Backend Runbook

Status: engineering-only; production intervention disabled

This runbook operates the native NestJS, PostgreSQL, LiveKit, and FastAPI path without a frontend.
It does not promote Phase O, Phase P, or Phase Q and does not authorize a production intervention.

## Safety state

The committed development profile is intentionally fail-closed:

```text
Phase O scientific calibration: BLOCKED
Phase P engineering: IMPLEMENTED_NOT_PROMOTED
Phase P production activation: BLOCKED_BY_PHASE_O
Phase Q engineering: IMPLEMENTED_NOT_PROMOTED
Phase Q production activation: BLOCKED_BY_PHASE_O_AND_PHASE_P
Phase R: LOCKED
```

`ML_PROVIDER=stub`, `ML_EVIDENCE_MODE=SIMULATED`, and
`RISK_INTERVENTION_MODE=ENGINEERING_ONLY` are development settings. They produce explicitly tagged
`DEMO` records only. `SHADOW` evidence may be assessed and observed but creates no intervention.
Production startup rejects engineering-only risk mode, and production activation independently
requires promoted O/P/Q statuses plus valid calibration/model/preprocessing provenance.

## Native preparation and startup

1. Copy `.env.example` to an uncommitted local environment file and replace every
   `replace_with_...` value with development-only credentials. Never commit that file.
2. Install the backend and ML locked dependencies using their service-owned manifests.
3. Verify the host and initialize the native database role/database:

```powershell
pwsh -NoProfile -File infrastructure/local-windows/check-prerequisites.ps1 -EnvFile <local-env-path>
pwsh -NoProfile -File infrastructure/local-windows/init-postgres.ps1 -EnvFile <local-env-path>
```

4. Apply committed migrations and start the native services:

```powershell
Set-Location backend
npm run db:migrate:deploy
Set-Location ..
pwsh -NoProfile -File infrastructure/local-windows/start-all.ps1 -EnvFile <local-env-path>
```

5. Stop only the recorded SWAR processes:

```powershell
pwsh -NoProfile -File infrastructure/local-windows/stop-all.ps1
```

Docker, Compose, Testcontainers, persistent call-audio storage, and a direct FastAPI-to-PostgreSQL
path are prohibited.

## Health and operational visibility

- `GET /health` is process liveness and does not probe dependencies.
- `GET /health/ready` reports bounded PostgreSQL, ML-liveness, and LiveKit dependency readiness.
  FastAPI's separate `/health/ready` is the fail-closed production-model/calibration readiness gate.
- `GET /health/metrics` emits privacy-safe aggregate queue, drop-reason, FAST/DEEP latency, retry,
  outbox, replay/ack, intervention, and readiness-failure counters/gauges. Restrict this endpoint to
  the operator network or native reverse proxy; it is not a customer API.
- Structured logs contain allowlisted identifiers, versions, outcomes, counts, and reason codes.
  They must never contain audio, PCM, embeddings, tensors, tokens, request bodies, secrets, or
  private call content.

FastAPI production readiness returning HTTP 503 because Phase O/calibration promotion is blocked is
the expected engineering state, not a reason to alter the gates. NestJS production configuration
and risk activation independently reject unpromoted O/P/Q state.

## Durable evidence-to-event loop

An accepted evidence revision enters one serializable PostgreSQL transaction. That transaction
validates tenant/call/session/binding/policy provenance and atomically writes the accepted evidence,
risk assessment, assessment/evidence links, optional tagged risk transition, optional `DEMO`
intervention decisions, durable security-event outbox records, and non-sensitive audit facts.
Failure rolls back the entire unit. Stable idempotency and external event IDs coalesce duplicate
delivery and concurrent replay.

The outbox dispatcher uses a bounded batch, maximum attempt count, exponential backoff, and stable
event identity. A failed callback leaves a retryable or terminally failed record; it never rewrites
the risk decision. Authenticated WebSocket subscriptions are limited to calls authorized for the
JWT membership and organization. Replay is cursor-bounded, and acknowledgement validates the same
tenant/call/membership scope before recording delivery acknowledgement.

## Failure recovery

- PostgreSQL unavailable: reject the mutation; never acknowledge an uncommitted decision.
- ML/model unavailable: preserve explicit degraded/error evidence; never manufacture a benign
  score.
- Outbox publish unavailable: retry within the configured bound, retain the stable event ID, and
  expose only the failure category in telemetry.
- Client reconnect: reauthenticate, reauthorize requested calls, and replay from the last accepted
  event ID. Deduplicate by `eventId`.
- Duplicate, stale, late, or corrected FAST/DEEP evidence: use event/window sequence and revision;
  never use arrival timestamp to rewrite history.
- Shutdown/cancellation/timeout: drain bounded durable work where possible and clear ML audio,
  window, tensor, and embedding buffers.

## Verification commands

```powershell
Set-Location backend
npm run format:check
npm run lint
npm run typecheck
npm run prisma:validate
npm run build
npm run test:contract
npm test
npm run test:database:native
npm run test:auth:native
Set-Location ..
pwsh -NoProfile -File infrastructure/checks/documentation.ps1
pwsh -NoProfile -File infrastructure/checks/repository-boundaries.ps1
pwsh -NoProfile -File infrastructure/checks/repository-boundaries.tests.ps1
```

These engineering checks prove orchestration, transactionality, isolation, and fail-closed behavior.
They do not prove model accuracy, calibration, latency targets, legal compliance, or production
readiness.
