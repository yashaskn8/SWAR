# ADR-002: Backend-Bound Authoritative Caller Track

Status: Accepted  
Date: 2026-08-28  
Decision owners: SWAR media-security and backend architecture  
Requirements: FR-CALL-003, FR-CALL-004, FR-CALL-005, FR-CALL-006, NFR-SEC-002

## Context

A modified client can mislabel an identity, upload clean substitute audio, publish multiple tracks, or reconnect with a new track. Room membership alone does not prove which participant/track is the caller audio that the customer receives.

## Decision

NestJS owns a versioned authoritative binding among organization, call ID, room name, caller participant identity, and caller track SID. The binding originates from backend call authorization plus authenticated LiveKit lifecycle events, never a caller claim.

The ML analysis grant contains the expected binding and expiry. The restricted ML subscriber joins with a short-lived subscribe-only participant JWT, observes LiveKit metadata, and analyzes only the exact current bound audio track. Multiple, wrong, missing, or republished tracks require explicit backend selection/binding revision; the ML service does not guess.

The analyzed track is the LiveKit-routed caller track delivered to the customer. There is no separate client-upload analysis stream.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Trust a client-supplied employee ID or track SID | A compromised client can redirect analysis or claim a trusted identity. |
| Analyze the first/only audio track observed | Multiple tracks, reconnects, race conditions, and malicious ordering make this ambiguous. |
| Analyze mixed room audio | Loses caller attribution and contaminates identity/spoof evidence. |
| Upload a recording from the customer device | It is not the authoritative server-routed track and creates a substitution/privacy path. |

## Consequences and trade-offs

- Positive: wrong-track, cross-tenant, and clean-audio substitution have a testable rejection rule.
- Positive: evidence can carry stable call/participant/track/session/window lineage.
- Cost: analysis may start late while waiting for an authenticated publish event and binding.
- Cost: reconnect/republish handling needs binding revisions and coverage gaps rather than seamless guessing.
- Failure rule: no valid binding means no analysis evidence; protected actions use degraded/step-up policy.

## Compatibility

This ADR implements ADR-001's controlled media boundary, sends only transient audio to the ADR-004 ML boundary, and leaves all risk/action decisions with ADR-003 NestJS.

