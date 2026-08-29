# SWAR entity-relationship diagram

Version: 1.0.0  
Frozen: 2026-08-28

The diagram mirrors the models in `backend/prisma/schema.prisma`. Tenant relations shown here are implemented with `organizationId` plus entity IDs; the schema is authoritative for exact field and constraint syntax.

```mermaid
erDiagram
    Organization ||--o{ OrganizationMembership : owns
    User ||--o{ OrganizationMembership : joins
    OrganizationMembership ||--o{ OrganizationMembershipRole : receives
    Organization ||--o{ OrganizationMembershipRole : scopes
    OrganizationMembership ||--o{ Device : registers
    Device ||--o{ RefreshSession : binds
    OrganizationMembership ||--o{ RefreshSession : authenticates

    Organization ||--o{ TrustedSpeaker : owns
    User o|--o{ TrustedSpeaker : represents
    TrustedSpeaker ||--o{ EnrollmentConsent : grants_for
    OrganizationMembership ||--o{ EnrollmentConsent : records
    EnrollmentConsent ||--o{ Voiceprint : authorizes
    TrustedSpeaker ||--o{ Voiceprint : enrolls
    ModelVersion ||--o{ Voiceprint : produces

    Organization ||--o{ RiskPolicy : owns
    OrganizationMembership ||--o{ RiskPolicy : creates
    Organization ||--o{ Call : owns
    TrustedSpeaker o|--o{ Call : expected_in
    RiskPolicy ||--o{ Call : governs
    OrganizationMembership ||--o{ Call : creates
    Call ||--o{ CallParticipant : authorizes
    OrganizationMembership o|--o{ CallParticipant : participates_as
    TrustedSpeaker o|--o{ CallParticipant : maps_to
    CallParticipant ||--o{ MediaTrack : publishes
    Call ||--o{ MediaTrack : carries
    Call ||--o{ TrackBinding : binds
    CallParticipant ||--o{ TrackBinding : authorized_actor
    MediaTrack ||--|| TrackBinding : authorized_track

    TrackBinding ||--o{ AnalysisSession : authorizes
    Call ||--o{ AnalysisSession : analyzes
    Voiceprint o|--o{ AnalysisSession : compares_with
    AnalysisSession ||--o{ EvidenceEvent : emits
    TrackBinding ||--o{ EvidenceEvent : proves_source
    ModelVersion o|--o{ EvidenceEvent : scores_with
    EvidenceEvent o|--o{ EvidenceEvent : supersedes

    RiskPolicy ||--o{ RiskEvent : evaluates_with
    Call ||--o{ RiskEvent : transitions
    AnalysisSession o|--o{ RiskEvent : informs
    RiskEvent ||--o{ RiskEventEvidence : cites
    EvidenceEvent ||--o{ RiskEventEvidence : cited_by
    RiskEvent ||--o{ Intervention : requires
    Intervention ||--o{ VerificationChallenge : verifies
    RiskEvent ||--o{ Alert : publishes
    Intervention o|--o{ Alert : announces

    Organization ||--o{ AuditLog : records
    OrganizationMembership o|--o{ AuditLog : acts
```

## Aggregate roots and ownership

| Aggregate | Root | Internal records | Cross-aggregate references |
|---|---|---|---|
| Tenant identity | `Organization` | `OrganizationMembership`, `OrganizationMembershipRole`, `Device`, `RefreshSession` | Global `User` |
| Enrollment | `TrustedSpeaker` | `EnrollmentConsent`, `Voiceprint` | `OrganizationMembership`, global `ModelVersion` |
| Controlled call | `Call` | `CallParticipant`, `MediaTrack`, `TrackBinding`, `AnalysisSession` | `TrustedSpeaker`, `RiskPolicy` |
| Risk decision | `RiskEvent` | `RiskEventEvidence` | `Call`, `AnalysisSession`, `EvidenceEvent`, `RiskPolicy` |
| Intervention | `Intervention` | `VerificationChallenge`, related `Alert` | `RiskEvent`, `Call`, resolving membership |
| Governance/audit | `ModelVersion`, `RiskPolicy`, `AuditLog` | Version and append-only records | Tenant actors and opaque audited targets |

## Authoritative binding key

The durable media authorization tuple is:

`organizationId + callId + CallParticipant.livekitIdentity + MediaTrack.trackSid + TrackBinding.revision`

`displayName`, client-provided labels, room metadata, and track labels do not replace this tuple. A new SID creates a new track/binding revision.
