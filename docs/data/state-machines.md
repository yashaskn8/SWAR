# SWAR domain state machines

Version: 1.0.0  
Frozen: 2026-08-28

Transitions are executed by NestJS in tenant-scoped transactions with optimistic/current-state checks, stable idempotency keys, audit records, and explicit errors. A repeated request with the same key returns the committed result; the same key with different input is rejected. Unlisted transitions are illegal.

## Call lifecycle

```mermaid
stateDiagram-v2
    [*] --> REQUESTED
    REQUESTED --> AUTHORIZED: grants and policy bound
    REQUESTED --> CANCELLED: cancelled before authorization
    REQUESTED --> FAILED: authorization failed
    AUTHORIZED --> ACTIVE: authorized participant joined
    AUTHORIZED --> CANCELLED: cancelled before start
    AUTHORIZED --> FAILED: grant or room failure
    ACTIVE --> ENDING: end requested or enforced
    ACTIVE --> FAILED: unrecoverable runtime failure
    ENDING --> ENDED: media and analysis stopped
    ENDING --> FAILED: bounded cleanup failed
    CANCELLED --> [*]
    ENDED --> [*]
    FAILED --> [*]
```

`ENDED`, `CANCELLED`, and `FAILED` are terminal. Ending a call revokes grants/bindings, stops analysis, clears transient audio/embeddings, and records a versioned event; it does not delete durable minimal evidence.

## Consent and voiceprint lifecycles

```mermaid
stateDiagram-v2
    state Consent {
        [*] --> GRANTED
        GRANTED --> REVOKED: subject or authorized operator revokes
        GRANTED --> EXPIRED: expiry reached
        REVOKED --> [*]
        EXPIRED --> [*]
    }
    state Voiceprint {
        [*] --> ENROLLING
        ENROLLING --> ACTIVE: quality accepted and ciphertext committed
        ENROLLING --> FAILED: validation or inference failed
        ACTIVE --> REVOKED: consent revoked or use disabled
        ACTIVE --> DELETED: authorized deletion clears ciphertext
        REVOKED --> DELETED: authorized deletion clears ciphertext
        FAILED --> DELETED: cleanup clears any ciphertext
        DELETED --> [*]
    }
```

Revocation prevents future use immediately. Deletion requires `ciphertext = null`, `deletedAt` set, no plaintext material retained, and an audit event. Re-enrollment creates new consent/voiceprint versions; it never reactivates a deleted record.

## Track binding and analysis lifecycles

```mermaid
stateDiagram-v2
    state Binding {
        [*] --> AUTHORIZED
        AUTHORIZED --> ACTIVE: exact participant and SID verified
        AUTHORIZED --> REJECTED: binding mismatch or expired grant
        AUTHORIZED --> REVOKED: call ended or authorization withdrawn
        ACTIVE --> SUPERSEDED: reconnect or new track SID
        ACTIVE --> REVOKED: call ended or authorization withdrawn
        SUPERSEDED --> [*]
        REVOKED --> [*]
        REJECTED --> [*]
    }
    state Analysis {
        [*] --> AUTHORIZED
        AUTHORIZED --> STARTING: ML accepts exact binding grant
        AUTHORIZED --> REVOKED: grant withdrawn
        AUTHORIZED --> EXPIRED: grant expires
        STARTING --> ACTIVE: subscriber attached to exact SID
        STARTING --> FAILED: attach or validation error
        STARTING --> REVOKED: grant withdrawn
        ACTIVE --> DEGRADED: voiceprint revoked or model path unavailable
        ACTIVE --> STOPPING: stop requested
        ACTIVE --> FAILED: unrecoverable pipeline error
        ACTIVE --> EXPIRED: grant expires
        ACTIVE --> REVOKED: binding or call revoked
        DEGRADED --> ACTIVE: authorized capability recovers
        DEGRADED --> STOPPING: stop requested
        DEGRADED --> FAILED: unrecoverable pipeline error
        DEGRADED --> EXPIRED: grant expires
        DEGRADED --> REVOKED: binding or call revoked
        STOPPING --> STOPPED: buffers cleared and subscriber detached
        STOPPING --> FAILED: bounded cleanup failed
        STOPPED --> [*]
        FAILED --> [*]
        EXPIRED --> [*]
        REVOKED --> [*]
    }
```

A superseded/revoked/rejected binding cannot accept new evidence. Recovery from `DEGRADED` is allowed only if the same authorized binding remains active; voiceprint revocation cannot be reversed by recovery and requires a new authorized session for later re-enrollment.

## Evidence revision rules

Evidence events are immutable facts, not mutable states:

1. Transport replay uses the same tenant/idempotency key and returns the original event.
2. A unique `(organization, analysisSession, windowSequence, evidenceType, revision)` identifies one semantic revision.
3. A replacement uses a greater revision and `supersedesEvidenceId`; the prior event becomes `SUPERSEDED` only through a controlled classification update or is already inserted with its final acceptance classification in the same transaction.
4. A lower/equal conflicting revision is `STALE`/`REJECTED`; identical content is `DUPLICATE`.
5. FAST and DEEP are distinct evidence types and may arrive out of order. Risk evaluation uses accepted facts in semantic window order and creates a new immutable risk event when late evidence changes state.
6. Model, checkpoint, score direction, calibration, and schema snapshots are never rewritten.

## Risk state machine

```mermaid
stateDiagram-v2
    [*] --> UNVERIFIED: trusted identity not established
    UNVERIFIED --> VERIFIED: high identity and low spoof persists
    UNVERIFIED --> HIGH_RISK: low identity and high spoof persists
    UNVERIFIED --> CRITICAL: high identity and high spoof persists
    VERIFIED --> UNVERIFIED: verified evidence clears
    VERIFIED --> HIGH_RISK: identity lowers while spoof rises
    VERIFIED --> CRITICAL: strong spoof coexists with high identity
    HIGH_RISK --> UNVERIFIED: high spoof evidence clears
    HIGH_RISK --> VERIFIED: accepted evidence supports verified matrix cell
    HIGH_RISK --> CRITICAL: identity rises with high spoof
    CRITICAL --> HIGH_RISK: identity lowers while spoof remains high
    CRITICAL --> UNVERIFIED: accusation evidence clears without verification
    CRITICAL --> VERIFIED: independent accepted evidence and clearing policy pass
```

Each arrow requires the active versioned policy's persistence/hysteresis conditions; Phase Q defines settings only after Phase O calibration evidence. Same-state evidence updates the timeline without inventing a state transition. `INSUFFICIENT_EVIDENCE` and `PIPELINE_ERROR` continue monitoring/degraded protection and cannot independently enter `HIGH_RISK` or `CRITICAL`. `UNVERIFIED` is never named safe.

## Intervention, verification, and alert lifecycles

```mermaid
stateDiagram-v2
    [*] --> REQUIRED
    REQUIRED --> ACKNOWLEDGED: authorized client acknowledges
    REQUIRED --> IN_PROGRESS: server starts action
    REQUIRED --> EXPIRED: policy expiry
    REQUIRED --> CANCELLED: authorized policy cancellation
    REQUIRED --> FAILED: server action failed
    ACKNOWLEDGED --> IN_PROGRESS: step-up or callback starts
    ACKNOWLEDGED --> EXPIRED: policy expiry
    IN_PROGRESS --> SATISFIED: independent verification/policy passes
    IN_PROGRESS --> DECLINED: user declines
    IN_PROGRESS --> EXPIRED: policy expiry
    IN_PROGRESS --> FAILED: bounded workflow fails
    SATISFIED --> [*]
    DECLINED --> [*]
    EXPIRED --> [*]
    CANCELLED --> [*]
    FAILED --> [*]
```

- A `HOLD_PROTECTED_ACTION` remains effective through WebSocket/dashboard/ML disconnection and is released only after `SATISFIED` under authorized policy.
- Verification: `PENDING -> PASSED | FAILED | EXPIRED | CANCELLED`; each retry is a new bounded `attemptNumber`. No OTP/answer is persisted in this model.
- Alert: `PENDING -> DELIVERED | FAILED | CANCELLED`. Retry increments `attemptCount` under a later bounded-delivery policy; an alert failure never changes risk or releases a hold.

## Four mandatory orchestration walks

| Scenario | Accepted evidence | Risk/event result | Intervention behavior |
|---|---|---|---|
| Genuine trusted speaker | Quality-ready, high expected-speaker similarity, low spoof evidence, versioned model facts | `VERIFIED` after policy persistence; linked immutable `RiskEvent` | No accusation or hold solely from this scenario. |
| Unknown genuine speaker | Quality-ready, low identity, low spoof | `UNVERIFIED`; never a safe label | Continue monitoring; protected workflow may require normal independent authorization. |
| Trusted voice clone | Quality-ready, high identity and high spoof | `CRITICAL` after policy persistence | Idempotent warning plus server-side hold; independent step-up/callback required. |
| Weak/insufficient audio | `INSUFFICIENT_EVIDENCE` with reason codes | Retain current state or degraded/monitoring outcome per policy; no synthetic accusation | Continue monitoring; do not create `CRITICAL` from quality failure. |

These walks prove only contract orchestration. They contain no model score, threshold, accuracy, or latency claim.

## Transaction and concurrency rules

- Transition commands compare the current status/version and write domain record plus audit/outbox alert intent atomically where applicable.
- Scoped sequences are allocated/checked inside the call or analysis transaction. Late arrival time never overrides semantic sequence/revision.
- A version activated concurrently with an active call does not rewrite that call's frozen policy version or any existing event snapshot.
- Deletion/revocation wins over in-flight enrollment/analysis: dependent writes re-check consent/voiceprint/binding status before commit and fail explicitly when no longer valid.
