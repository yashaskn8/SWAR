# ADR-001: Controlled LiveKit/WebRTC Scope

Status: Accepted  
Date: 2026-08-28  
Decision owners: SWAR architecture owner and product/security contract  
Requirements: FR-CALL-001, FR-CALL-002, NFR-COMP-002, NFR-COMP-001

## Context

Voice-cloning risk is meaningful only when SWAR can authorize the communication session, bind identities and media, and connect risk to a protected workflow. Ordinary Android applications cannot be assumed to capture arbitrary GSM/VoLTE or third-party call audio. The SIH build also cannot support every enterprise telephony adapter while preserving a verifiable same-track property.

## Decision

The SIH product scope is enterprise-controlled LiveKit/WebRTC calling. NestJS authorizes the call and short-lived participant grants; LiveKit routes the media; a restricted ML service participant subscribes to the backend-authorized caller track. Android and React use NestJS public contracts and the authorized LiveKit media plane only.

SIP/contact-centre adapters are `FUTURE ENTERPRISE INTEGRATION`. Arbitrary cellular-call interception is excluded.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Analyze arbitrary device/cellular call audio | Platform capability and authorization cannot be assumed; it would violate the controlled-call contract. |
| Client records/uploads a second audio copy | The analyzed media could differ from what the customer heard and be substituted by a modified client. |
| Implement WebRTC and SIP/contact-centre paths together | Expands unverified integration/security scope and weakens SIH feasibility. |
| File-upload-only classifier | Does not prove real-time authoritative media, temporal policy, or action intervention. |

## Consequences and trade-offs

- Positive: real call authorization, participant identity, track binding, media grants, and action context can be tested end to end.
- Positive: avoids unsupported cellular-monitoring claims and a second untrusted media stream.
- Cost: callers and recipients must use the enterprise application/channel.
- Cost: existing telephony/contact-centre deployments need a future adapter and new validation.
- Student feasibility: one LiveKit/WebRTC path is implementable natively without Docker and keeps the demo honest.

## Compatibility

This ADR is consistent with ADR-002 (same caller track), ADR-003 (NestJS business authority), ADR-004 (transient audio), and ADR-005 (native deployment).

