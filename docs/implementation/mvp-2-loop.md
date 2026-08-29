# SWAR Phase M Headless Development Loop

Status: Phase M development/test loop

Contract inputs: Phase J ML evidence schema, Phase K governance, Phase L preprocessing, Phase H
backend platform

## Scope

This loop proves authenticated technical-evidence delivery before real model adapters or frontend
code exist. It deliberately stops at NestJS's persisted `EvidenceEvent` boundary. Phase Q remains
the owner of temporal policy, business `RiskEvent` creation, `VERIFIED`/`UNVERIFIED`/`HIGH_RISK`/
`CRITICAL`, and interventions.

The loop consists of:

1. [`DevelopmentStub`](../../ml/app/inference/development_stub.py), which creates deterministic
   scenario fixtures;
2. `BackendEvidenceCallbackClient`, which sends the exact Phase J payload with a dedicated service
   credential and event-ID idempotency key; and
3. the existing NestJS internal callback, which authenticates, validates the authorized
   organization/call/session/track binding, classifies terminal evidence as stale, and persists the
   technical event.

There is no public score or scenario-selection endpoint. Tests and native/headless clients invoke
the loop directly.

## Two independent stub gates

The stub constructor succeeds only when both settings explicitly select it:

```text
APP_ENV=test or development
ML_PROVIDER=stub
```

Any missing/other provider or environment fails closed. `create_app()` performs an independent
startup check and raises `STUB_FORBIDDEN_IN_PRODUCTION` when `APP_ENV=production` and
`ML_PROVIDER=stub`. Unit tests prove both constructor and service-startup rejection.

Phase N introduces verified model adapters. Phase P supplies the authorized LiveKit subscriber and
production serving path. The Phase M module remains explicitly named development-only; it is never
a fallback for unavailable production models.

## Persistent non-scientific labels

The frozen Phase J JSON Schema forbids unknown callback fields. To preserve that contract while
making every stub event unmistakable after persistence, all stub events carry these stable
`reasonCodes`:

- `PROVIDER_STUB`;
- `NON_SCIENTIFIC_TEST_EVIDENCE`; and
- exactly one `SCENARIO_<NAME>` label.

Ready fixtures additionally use `SWAR_DEVELOPMENT_STUB_*`,
`phase-m-development-stub-v1`, and `stub_non_scientific_raw_score`. The required checkpoint-hash
field contains the SHA-256 of the public stub descriptor, not a model checkpoint. Stub raw values
are deterministic orchestration inputs, not probabilities, confidence, accuracy, or detector
results.

## Event and delivery behavior

The scenarios cover technical evidence only:

| Scenario | Stub evidence |
|---|---|
| `TRUSTED_GENUINE` | Identity FAST, spoof FAST, and spoof DEEP fixture scores |
| `UNKNOWN_GENUINE` | Identity FAST, spoof FAST, and spoof DEEP fixture scores |
| `TRUSTED_CLONE` | Identity FAST, spoof FAST, and spoof DEEP fixture scores |
| `INSUFFICIENT_AUDIO` | `INSUFFICIENT_EVIDENCE` with `INSUFFICIENT_SPEECH` |
| `PIPELINE_FAILURE` | `PIPELINE_ERROR` with `STUB_CONFIGURED_PIPELINE_ERROR` |

These names do not assert a backend risk state. Deep delivery can be configured before or after
FAST. The builder allocates monotonically increasing `eventSequence` values in actual configured
delivery order while keeping window sequence and evidence revision explicit.

The callback sends:

```text
Authorization: Bearer <dedicated ML service secret>
X-SWAR-Service: swar-ml
Idempotency-Key: <body eventId>
```

Only `202` with the matching event ID and `ACCEPTED` or `STALE` is success. Authentication,
validation, binding, and idempotency conflicts are not retried. Transport and 5xx failures use at
most three attempts with the identical event ID and payload. Errors contain stable codes only and
never include the secret, body, audio, embedding, or backend response content.

## Verification evidence

- [`test_development_stub.py`](../../ml/tests/unit/inference/test_development_stub.py) proves both
  gates, production startup rejection, deterministic labels, configurable DEEP order, authenticated
  headers, bounded retry, and non-retry of contract failures.
- [`test_backend_evidence_loop.py`](../../ml/tests/integration/test_backend_evidence_loop.py) sends
  all four Phase J event envelopes across an HTTP client boundary, checks schema field drift,
  authentication, event-ID idempotency, duplicate replay, and rejection behavior.
- [`stub-evidence-loop.spec.ts`](../../backend/tests/integration/analysis/stub-evidence-loop.spec.ts)
  drives the actual NestJS controller, service guard, DTO validation, binding validation, evidence
  mapping, idempotent persistence boundary, and stale classification without a frontend.
- Existing native PostgreSQL repository tests prove durable evidence idempotency and conflicting-key
  rejection; Phase M does not add a schema or migration.

## Security and privacy

- Scenario selection is a local class input, not a production/public route.
- The callback remains service-authenticated and bound to backend-authorized tenant, call, analysis
  session, and track IDs.
- Stub fixtures contain fictional UUIDs and no audio, embedding, transcript, personal name,
  credential, or private call content.
- The baseline and loop persist no raw audio or reusable feature arrays.
- No frontend, model checkpoint, model metric, risk threshold, or business intervention is created
  in Phase M.
