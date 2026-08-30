# SIH Headless Engineering Demo Runbook

Status: non-production fixture demonstration

This runbook demonstrates SWAR's backend orchestration without a frontend and without claiming
scientific detector performance. It uses fictional test identities, synthetic numeric fixtures,
native PostgreSQL, and explicitly tagged `DEMO` evidence. It must never be used for a real customer,
real protected action, production warning, or production hold.

## Required gates

Use a non-production runtime with all of the following:

```text
ML_PROVIDER=stub
ML_EVIDENCE_MODE=SIMULATED
RISK_INTERVENTION_MODE=ENGINEERING_ONLY
PHASE_O_SCIENTIFIC_STATUS=BLOCKED
PHASE_P_PRODUCTION_STATUS=BLOCKED_BY_PHASE_O
PHASE_Q_PRODUCTION_STATUS=ENGINEERING_ONLY
```

Do not paste real passwords, JWTs, LiveKit secrets, voice data, account numbers, or private call
content into commands, logs, screenshots, or reports. Use an uncommitted local environment file
derived from `.env.example`.

## Reproducible headless proof

Run the native PostgreSQL integration harness:

```powershell
Set-Location backend
npm run test:database:native
```

The `headless-risk-pipeline.e2e-spec.ts` suite constructs isolated fictional tenants and exercises:

1. trusted genuine fixture evidence -> `VERIFIED` in `DEMO` mode;
2. unknown genuine fixture evidence -> `UNVERIFIED` in `DEMO` mode;
3. trusted clone fixture evidence -> `CRITICAL` plus demo warning/hold/step-up decisions;
4. insufficient speech -> internal `INSUFFICIENT_EVIDENCE`, monitoring continues, and no
   accusation/intervention is created.

It also sends DEEP evidence before FAST evidence, replays the same evidence concurrently, forces a
downstream transaction failure, persists/replays/acknowledges stable security-event outbox records,
and attempts a cross-tenant write/ack. A valid run must show all native database tests passing and
must leave production `RiskEvent` count at zero for the fixture clone scenario.

## What may be shown

- Tagged `DEMO` risk assessment, transition, intervention-decision, and security-event metadata.
- Stable event IDs, replay acknowledgement, queue depth, retries, latency categories, and readiness
  blocker codes.
- PostgreSQL transaction rollback and tenant-isolation test outcomes.
- HTTP 503 production readiness while the scientific/promotion chain is blocked.

Do not present fixture thresholds, fixture scores, or test outcomes as model metrics, detector
accuracy, calibrated probabilities, or evidence that a real voice is genuine/spoofed.

## Shadow behavior

`SHADOW` is observation-only. It may create a suppressed assessment and a dashboard shadow event,
but it must not create a warning, hold, step-up, escalation, protected-action call, or production
security event. The real action adapter is not selected in this runbook.

## Exit and reset

Stop native processes through the recorded-process script:

```powershell
pwsh -NoProfile -File infrastructure/local-windows/stop-all.ps1
```

Do not delete migrations or rewrite test evidence to obtain a passing demonstration. A failed gate
is reported as failed. Phase R remains locked after the demo.
