# Backend engineering completion

Status date: 2026-08-31
Scope: backend, ML evidence transport, machine-readable contracts, native PostgreSQL tests, and
headless engineering/demo behavior only.

## Truthful gate status

```text
Backend engineering: COMPLETE
Headless backend demo: COMPLETE
Phase O scientific calibration: BLOCKED
Phase P engineering: IMPLEMENTED_NOT_PROMOTED
Phase P production activation: BLOCKED_BY_PHASE_O
Phase Q engineering: IMPLEMENTED_NOT_PROMOTED
Production ML interventions: FAIL-CLOSED
Frontend: NOT MODIFIED
Phase R: LOCKED
```

`COMPLETE` above describes the authorized backend engineering and headless-demo scope. It does not
claim scientific detector validation, fitted calibration, production model promotion, production
intervention activation, legal approval, or frontend completion.

## Implemented backend path

- Authenticated ML evidence is bound to the authoritative organization, call, analysis session,
  track binding, participant identity, and LiveKit track SID. The v2 envelope adds stable window and
  correlation identifiers plus capture/inference/observation timestamps. Substitution and invalid
  timestamp order are rejected before persistence.
- Accepted evidence, deterministic risk assessment, evidence links, transition, intervention,
  alert/outbox row, and audit row use the existing serializable atomic transaction. Duplicate,
  revised, late, out-of-order, and insufficient evidence remains deterministic and idempotent.
- Engineering interventions are tagged `DEMO`; shadow evidence cannot create an actionable control.
  The safe demo action adapter records warning, step-up/callback, supervisor-escalation, and
  end-call intents without an external side effect. The transaction-hold adapter remains demo-only
  and refuses production.
- Intervention dispatch uses bounded attempts, exponential retry, optimistic claims, expiring
  leases, deterministic idempotency keys, recovery after abandoned leases, and an explicit
  dead-letter timestamp. Provider error content is not logged.
- Authenticated REST operations now expose current call/security state, paginated security history,
  active alerts, alert acknowledgement, dashboard summary, and intervention acknowledgement,
  demo-hold, cancellation, verification, and independently verified release. Repository queries and
  mutations require `organizationId`; service authorization requires explicit permissions.
- The existing authenticated `/ws/security` subscription, replay, acknowledgement, connection
  bounds, revalidation, call authorization, canonical event identifiers, and subscriber isolation
  remain the realtime contract.
- A bounded maintenance worker expires analysis grants, independent-verification challenges, and
  pending interventions. It never auto-expires or releases an active hold and stops accepting work
  during graceful shutdown.
- Production readiness includes an explicit activation check and remains `not_ready` while the
  Phase O/P/Q promotion chain is blocked. Liveness remains independent.

## Privacy and retention

No raw call audio, PCM, tensors, embeddings, tokens, or private call content was added to persistent
storage, APIs, telemetry, or logs. Exact media identifiers and technical timestamps are classified
as C2 security evidence and follow `R-EVIDENCE`. ML audio and tensors remain transient and are
zeroed on completion, cancellation, timeout, exception, reconnect, and shutdown.

The repository intentionally does not invent evidence or audit retention durations. Tenant-scoped,
bounded deletion requires an organization-approved schedule and legal/security review; exact
durations remain `VALIDATION REQUIRED` under the existing retention contract.

## Headless acceptance scenarios

The native PostgreSQL headless test drives only labelled fictional engineering evidence:

- trusted genuine fixture -> `VERIFIED`;
- unknown genuine fixture -> `UNVERIFIED`;
- trusted clone fixture -> `CRITICAL` plus demo warning, demo hold, and step-up intent;
- poor audio fixture -> `INSUFFICIENT_EVIDENCE` with no accusation/intervention;
- one noisy high-spoof transient followed by low-spoof evidence -> no false `CRITICAL` and no hold.

These scenarios verify orchestration and failure handling only. They are not detector metrics or
scientific evidence.

## Production promotion dependency

Production activation stays fail-closed until governed Phase O data, measured evaluation, fitted
calibration, a named target-hardware profile, and explicit approval promote Phase O; Phase P serving
is then production-promoted; Phase Q policy and adapters receive security review and explicit
promotion. No configuration rename or bypass in this implementation shortens that chain.

## Verification evidence

- Backend complete ordinary suite: `97 passed`, `17 skipped` native-only/conditional tests.
- Backend static gates: Prettier, ESLint, strict TypeScript, Nest build, Prisma generation and schema
  validation passed. The initial final ESLint run found one unused test destructure; it was removed
  and the focused lint/type/contract rerun passed.
- ML complete suite: `117 collected`; `116 passed`, one conditional real-checkpoint smoke skipped.
  Ruff lint/format and `pip check` passed. The initial Ruff format check identified one decorator
  wrapping difference; Ruff formatted it and the check rerun passed.
- Contract suite: `21/21` passed across REST drift/schema, WebSocket, service-auth, webhook,
  evidence binding, replay, and adapter-security tests.
- Fresh native PostgreSQL: all six migrations applied, status was current, seed replay was
  idempotent, no-op migration replay passed, database/headless suite `13/13` passed, and native
  authentication/RBAC/tenant suite `11/11` passed. The restricted-token sandbox attempt could not
  start PostgreSQL; the authorized native rerun passed and both temporary servers stopped cleanly.
- Documentation: headings and links passed for `60` Markdown files. Positive and negative
  repository/no-container boundaries, `git diff --check`, 49-file changed-secret scan, sensitive
  artifact scan, and no-Docker scan passed.
