# SWAR Failure and Fallback Architecture

Status: FROZEN - Phase B  
Date: 2026-08-28

The system fails explicitly and preserves protection; it never manufactures low-risk evidence or silently releases an active hold.

## Failure matrix

| Failure/edge case | Detection | Required behavior | Persisted/audited evidence | Forbidden behavior |
|---|---|---|---|---|
| Insufficient or low-quality audio | ML quality/VAD reason codes | Emit `INSUFFICIENT_EVIDENCE`, continue monitoring, and require step-up for a protected action according to policy. | Quality outcome, reason codes, time range, versions. | `CRITICAL` solely from poor quality or a false low-spoof score. |
| RawNet2 missing/not ready | Model readiness/error | Emit `PIPELINE_ERROR`/not-ready for FAST; use no fabricated score; protection is degraded. | Model/hash/profile and error category without stack secrets. | Treat missing FAST as low spoof. |
| AASIST timeout/missing | Deadline and model readiness | Retain FAST evidence with explicit uncertainty/deep-not-ready; existing risk cannot be silently cleared; accept late result only if session/revision remains valid. | Timeout, window/session/revision, versions. | Block indefinitely, count timeout as benign, or apply after end. |
| ECAPA/no voiceprint | Identity readiness/lifecycle state | Identity unavailable; never produce `VERIFIED`; spoof path remains usable for `HIGH_RISK`. | Reason and voiceprint/model lifecycle metadata. | Treat missing identity as trusted or safe. |
| LiveKit subscriber joins late | Analysis start timestamps and coverage | Mark early coverage missing; collect new valid windows; protected actions may require step-up while protection is degraded. | Coverage start and degraded interval. | Backfill or invent unheard audio. |
| Wrong participant or track delivered | Binding validator mismatch | Unsubscribe/reject, emit binding error, stop evidence for that source, request authorized rebinding. | Expected/observed non-sensitive IDs and correlation. | Guess the track or analyze another participant. |
| Caller publishes multiple audio tracks | Verified webhook and subscriber track list | NestJS selects exactly one binding or fails explicitly; extra tracks produce no evidence. | Track lifecycle and binding decision. | Mix tracks or select client-preferred track. |
| Caller reconnects/republishes | New participant/track lifecycle event | Quarantine new SID until backend issues a binding revision; stop old-track acceptance at the revision boundary. | Old/new binding versions and effective sequence/time. | Merge old/new streams silently. |
| ML loses room connection | RTC disconnect/timeout | Close transient buffers, emit degraded pipeline status, bounded reconnect with fresh/valid grant and exact binding; sensitive actions use step-up. | Disconnect/reconnect attempt category and coverage gap. | Reuse expired grant indefinitely or retain stale buffers. |
| AASIST result out of order | Window/session/revision validation | Accept only strictly valid newer revision; deterministically replace prior contribution; ignore duplicate/stale. | Rejected revision reason and current accepted revision. | Count revisions as separate windows. |
| AASIST result after call end | Closed analysis/call status | Reject for state/action; optionally record non-sensitive late-result metric. | Late result reference and closed-session reason. | Create, clear, or release an intervention. |
| NestJS restart during call | Process restart and durable session state | Reconstruct call/binding/risk/hold from PostgreSQL and verified LiveKit state before accepting new evidence; expose protection degraded until reconciled. | Restart/reconciliation events and state version. | Reset to low risk or clear hold. |
| ML restart during call | Health/session loss | Clear memory, require a new backend-authorized session/grant, restart evidence coverage without claiming continuity. | New session ID and coverage gap. | Recover raw audio from persistent storage or reuse old session state. |
| Expired/invalid user or LiveKit token | Auth/token validation | Reject request/join with stable expiry/auth error; client refreshes through NestJS if authorized. | Non-sensitive auth result/correlation. | Extend token client-side or expose server secret. |
| Forged/replayed webhook | Signature/timestamp/idempotency validation | Reject without binding mutation; alert/metric according to security policy. | Verification failure category/correlation. | Accept event based on payload alone. |
| PostgreSQL outage | Repository/transaction error | Reject new durable mutations and policy changes; do not acknowledge uncommitted holds/releases; preserve currently enforced external hold; expose degraded service. | Operational error outside DB where possible; reconciliation after recovery. | Continue with unscoped memory-only tenant mutations or release hold. |
| Database recovers after outage | Health/reconciliation | Reconcile idempotency keys, LiveKit lifecycle, analysis sessions and external action status before normal operation. | Reconciliation decisions and versions. | Replay duplicates without idempotency. |
| WebSocket/client disconnect | Connection state | Server policy and hold continue; authorized client fetches current state after reconnect. | Delivery attempts/current state version. | Release hold or reset state. |
| Dashboard outage | Health/availability | Customer protection, evidence ingestion, policy, and holds continue independently. | Operational health only. | Make dashboard a required policy hop. |
| Inference overload | Bounded queue/latency/stale threshold | Bound queues, reject/drop stale windows, report degraded coverage, prioritize current work according to approved policy. | Queue/stale counts and coverage, no audio. | Let delayed windows alter current state. |

## Retry and idempotency rules

- Retries are bounded, use backoff/deadlines appropriate to the operation, and retain the original idempotency key.
- Call actions, evidence revisions, risk transitions, holds, releases, verification results, webhooks, and security events have stable deduplication identities.
- A timeout means unknown/degraded, not success and not low risk.
- State-changing responses are acknowledged only after the authoritative transaction or external action state is known.
- Recovery reconciles by version/idempotency state; it does not delete evidence or reset to a favorable state to make progress.

## Operator-visible degraded modes

Degraded status may describe media coverage, ML readiness, database availability, event delivery, or client connectivity. It is operational metadata, not a new public risk state. User-facing risk remains one of the four frozen states when sufficient evidence exists; otherwise the workflow continues monitoring and applies trusted step-up according to backend policy.

