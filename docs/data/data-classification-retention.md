# SWAR data classification and retention

Version: 1.0.0  
Frozen: 2026-08-28

## Policy

Voice audio and embeddings are sensitive biometric-like data. Full call/enrollment audio, normalized PCM, waveform chunks, tensors, and plaintext embeddings are transient memory only and have no persistent field or entity. Buffers must be bounded and cleared on completion, termination, revocation, expiry, and error.

Retention periods are not invented here. This contract freezes the trigger and purpose for each class; the exact post-trigger duration remains `VALIDATION REQUIRED` from the organization's approved retention schedule and legal/security review. A longer duration cannot be selected merely because storage is available.

## Classification levels

| Code | Classification | Handling |
|---|---|---|
| C0 | Internal operational | Authenticated internal access; may appear in structured logs only if non-sensitive and necessary. |
| C1 | Confidential tenant metadata | Tenant-scoped access, encryption in transit/at rest, no public logs. |
| C2 | Sensitive personal/security evidence | Least-privilege role access, tenant scope, encrypted storage, redacted logs, audited access. |
| C3 | Restricted credential/biometric-like | Application-layer protection where specified, never logged, never returned broadly, deletion/revocation controls. |

## Retention rules

| Code | Trigger and retention rule |
|---|---|
| R-TENANT | Keep while the tenant/account relationship is active; on authorized erasure remove or irreversibly de-identify subject data, retaining only approved minimal audit proof. Exact audit tail is `VALIDATION REQUIRED`. |
| R-SESSION | Keep only through active/rotated/revoked/expired session handling and the approved replay-detection period, then delete. Exact replay window is `VALIDATION REQUIRED`. |
| R-BIOMETRIC | Ciphertext exists only while consent and voiceprint are active. Revocation blocks access immediately; deletion clears ciphertext immediately. Minimal consent/model/key-version/status proof follows approved audit retention. |
| R-CALL | Keep controlled-call binding/status metadata only for active operations and the approved security-investigation/audit period, then delete or de-identify. |
| R-EVIDENCE | Keep minimal evidence/risk/action provenance for the approved security/audit period; never retain source audio. |
| R-GOVERNANCE | Keep immutable policy/model version metadata while referenced plus the approved audit period after retirement. |
| R-AUDIT | Append-only, minimal audit proof through the approved security/legal retention period, then controlled deletion or de-identification. |

## Persistent field inventory

Virtual Prisma relation properties are not database columns; their classification follows the referenced persisted fields. Every persisted scalar field is listed below as `Model.field`.

| Entity fields | Class | Retention | Purpose and deletion behavior |
|---|---|---|---|
| `Organization.id`, `Organization.slug`, `Organization.displayName`, `Organization.status`, `Organization.createdAt`, `Organization.updatedAt` | C1 | R-TENANT | Tenant identity/lifecycle; explicit audited tenant erasure only. |
| `User.id`, `User.emailCanonical`, `User.status`, `User.createdAt`, `User.updatedAt`, `User.deletedAt` | C2 | R-TENANT | Global login identity and erasure lifecycle; email is removed/de-identified under approved deletion workflow. |
| `User.passwordHash` | C3 | R-TENANT | One-way Argon2id output only; replace on password change and remove on account deletion subject to security hold. Never log. |
| `OrganizationMembership.id`, `OrganizationMembership.organizationId`, `OrganizationMembership.userId`, `OrganizationMembership.status`, `OrganizationMembership.joinedAt`, `OrganizationMembership.revokedAt`, `OrganizationMembership.createdAt`, `OrganizationMembership.updatedAt` | C2 | R-TENANT | Tenant authorization history; revoke immediately, retain minimal proof per audit schedule. |
| `OrganizationMembershipRole.id`, `OrganizationMembershipRole.organizationId`, `OrganizationMembershipRole.membershipId`, `OrganizationMembershipRole.role`, `OrganizationMembershipRole.assignedAt` | C2 | R-TENANT | Authorization assignment; remove active grant immediately when revoked, retain audit event. |
| `Device.id`, `Device.organizationId`, `Device.membershipId`, `Device.devicePublicId`, `Device.label`, `Device.status`, `Device.lastSeenAt`, `Device.revokedAt`, `Device.createdAt`, `Device.updatedAt` | C2 | R-TENANT | Device/session security metadata; revoke immediately, delete/de-identify label and identifier after approved security tail. |
| `RefreshSession.id`, `RefreshSession.organizationId`, `RefreshSession.membershipId`, `RefreshSession.deviceId`, `RefreshSession.familyId`, `RefreshSession.status`, `RefreshSession.issuedAt`, `RefreshSession.expiresAt`, `RefreshSession.rotatedAt`, `RefreshSession.revokedAt`, `RefreshSession.createdAt`, `RefreshSession.updatedAt` | C2 | R-SESSION | Session family/replay lifecycle; delete after expiry/replay window. |
| `RefreshSession.tokenHash` | C3 | R-SESSION | Hash of refresh token only; never plaintext. Delete after expiry/replay window. |
| `TrustedSpeaker.id`, `TrustedSpeaker.organizationId`, `TrustedSpeaker.userId`, `TrustedSpeaker.externalReference`, `TrustedSpeaker.label`, `TrustedSpeaker.status`, `TrustedSpeaker.createdAt`, `TrustedSpeaker.updatedAt`, `TrustedSpeaker.revokedAt`, `TrustedSpeaker.deletedAt` | C2 | R-TENANT | Organization-scoped enrollment subject; revoke access immediately and erase/de-identify subject references on authorized deletion. |
| `EnrollmentConsent.id`, `EnrollmentConsent.organizationId`, `EnrollmentConsent.trustedSpeakerId`, `EnrollmentConsent.grantedByMembershipId`, `EnrollmentConsent.purposeCode`, `EnrollmentConsent.noticeVersion`, `EnrollmentConsent.status`, `EnrollmentConsent.grantedAt`, `EnrollmentConsent.expiresAt`, `EnrollmentConsent.revokedAt`, `EnrollmentConsent.revocationReasonCode`, `EnrollmentConsent.createdAt`, `EnrollmentConsent.updatedAt` | C2 | R-BIOMETRIC | Proof of purpose/version consent and lifecycle. Retain minimal proof without audio/embedding after revocation/deletion. |
| `Voiceprint.id`, `Voiceprint.organizationId`, `Voiceprint.trustedSpeakerId`, `Voiceprint.consentId`, `Voiceprint.modelVersionId`, `Voiceprint.createdByMembershipId`, `Voiceprint.embeddingFormat`, `Voiceprint.sampleCount`, `Voiceprint.status`, `Voiceprint.createdAt`, `Voiceprint.updatedAt`, `Voiceprint.activatedAt`, `Voiceprint.revokedAt`, `Voiceprint.deletedAt` | C2 | R-BIOMETRIC | Minimal enrollment provenance/lifecycle; after deletion retain only approved proof. Sample count is metadata, not samples. |
| `Voiceprint.ciphertext` | C3 | R-BIOMETRIC | Encrypted embedding only. Must become null on deletion and inaccessible immediately on revoke. Never log/cache outside the authorized session. |
| `Voiceprint.encryptionAlgorithm`, `Voiceprint.encryptionKeyVersion` | C3 | R-BIOMETRIC | Algorithm and external key reference/version, never key material. Retain only with referenced voiceprint/audit proof. |
| `ModelVersion.id`, `ModelVersion.modelName`, `ModelVersion.version`, `ModelVersion.capability`, `ModelVersion.checkpointHashSha256`, `ModelVersion.checkpointSource`, `ModelVersion.checkpointLicense`, `ModelVersion.inputSampleRateHz`, `ModelVersion.inputChannelCount`, `ModelVersion.scoreName`, `ModelVersion.scoreDirection`, `ModelVersion.calibrationVersion`, `ModelVersion.status`, `ModelVersion.createdAt`, `ModelVersion.validatedAt`, `ModelVersion.retiredAt` | C0 | R-GOVERNANCE | Governed immutable model provenance/semantics. No checkpoint bytes or credentials. |
| `Call.id`, `Call.organizationId`, `Call.roomName`, `Call.expectedTrustedSpeakerId`, `Call.riskPolicyId`, `Call.riskPolicyVersion`, `Call.createdByMembershipId`, `Call.idempotencyKey`, `Call.protectedActionReference`, `Call.status`, `Call.authorizedAt`, `Call.startedAt`, `Call.endedAt`, `Call.createdAt`, `Call.updatedAt` | C2 | R-CALL | Controlled-call authorization and opaque protected-action reference; no transaction payload or audio. De-identify/delete after security schedule. |
| `CallParticipant.id`, `CallParticipant.organizationId`, `CallParticipant.callId`, `CallParticipant.membershipId`, `CallParticipant.trustedSpeakerId`, `CallParticipant.livekitIdentity`, `CallParticipant.authorizedIdentity`, `CallParticipant.displayName`, `CallParticipant.role`, `CallParticipant.status`, `CallParticipant.authorizedAt`, `CallParticipant.joinedAt`, `CallParticipant.disconnectedAt`, `CallParticipant.leftAt`, `CallParticipant.createdAt`, `CallParticipant.updatedAt` | C2 | R-CALL | Authoritative participant identity/binding metadata; display name is non-authoritative but still tenant-confidential. |
| `MediaTrack.id`, `MediaTrack.organizationId`, `MediaTrack.callId`, `MediaTrack.participantId`, `MediaTrack.trackSid`, `MediaTrack.trackSource`, `MediaTrack.mimeType`, `MediaTrack.status`, `MediaTrack.publishedAt`, `MediaTrack.endedAt`, `MediaTrack.createdAt`, `MediaTrack.updatedAt` | C1 | R-CALL | Track metadata only; no frames, samples, or payload bytes. |
| `TrackBinding.id`, `TrackBinding.organizationId`, `TrackBinding.callId`, `TrackBinding.participantId`, `TrackBinding.mediaTrackId`, `TrackBinding.revision`, `TrackBinding.status`, `TrackBinding.authorizedAt`, `TrackBinding.activatedAt`, `TrackBinding.endedAt`, `TrackBinding.rejectionCode`, `TrackBinding.createdAt`, `TrackBinding.updatedAt` | C2 | R-CALL | Auditable server-authorized tuple/revision; retain only for binding/security history. |
| `AnalysisSession.id`, `AnalysisSession.organizationId`, `AnalysisSession.callId`, `AnalysisSession.trackBindingId`, `AnalysisSession.voiceprintId`, `AnalysisSession.idempotencyKey`, `AnalysisSession.bindingRevision`, `AnalysisSession.status`, `AnalysisSession.authorizedAt`, `AnalysisSession.startedAt`, `AnalysisSession.stoppedAt`, `AnalysisSession.expiresAt`, `AnalysisSession.failureCode`, `AnalysisSession.createdAt`, `AnalysisSession.updatedAt` | C2 | R-CALL | Authorization/lifecycle metadata only; no audio/session buffers persisted. |
| `RiskPolicy.id`, `RiskPolicy.organizationId`, `RiskPolicy.policyKey`, `RiskPolicy.version`, `RiskPolicy.schemaVersion`, `RiskPolicy.status`, `RiskPolicy.createdByMembershipId`, `RiskPolicy.effectiveAt`, `RiskPolicy.retiredAt`, `RiskPolicy.createdAt` | C2 | R-GOVERNANCE | Immutable tenant policy identity/lifecycle. |
| `RiskPolicy.policyDocument` | C2 | R-GOVERNANCE | Validated security policy configuration; may contain provisional thresholds only after validation/versioning. Never log wholesale. |
| `EvidenceEvent.id`, `EvidenceEvent.organizationId`, `EvidenceEvent.callId`, `EvidenceEvent.analysisSessionId`, `EvidenceEvent.trackBindingId`, `EvidenceEvent.modelVersionId`, `EvidenceEvent.supersedesEvidenceId`, `EvidenceEvent.idempotencyKey`, `EvidenceEvent.schemaVersion`, `EvidenceEvent.eventSequence`, `EvidenceEvent.windowSequence`, `EvidenceEvent.revision`, `EvidenceEvent.evidenceType`, `EvidenceEvent.readiness`, `EvidenceEvent.acceptanceStatus`, `EvidenceEvent.windowStartMs`, `EvidenceEvent.windowEndMs`, `EvidenceEvent.observedAt`, `EvidenceEvent.receivedAt`, `EvidenceEvent.processingLatencyMs`, `EvidenceEvent.speechDurationMs`, `EvidenceEvent.qualityScore`, `EvidenceEvent.reasonCodes`, `EvidenceEvent.errorCode`, `EvidenceEvent.createdAt` | C2 | R-EVIDENCE | Minimal ordered security/quality provenance. Timing and reason metadata contains no audio/content. |
| `EvidenceEvent.modelName`, `EvidenceEvent.modelVersion`, `EvidenceEvent.checkpointHashSha256`, `EvidenceEvent.scoreName`, `EvidenceEvent.scoreDirection`, `EvidenceEvent.rawScore`, `EvidenceEvent.calibratedScore`, `EvidenceEvent.calibrationVersion` | C2 | R-EVIDENCE | Derived biometric/spoof evidence and immutable semantics. Restrict access; no presentation as probability without verified calibration. |
| `RiskEvent.id`, `RiskEvent.organizationId`, `RiskEvent.callId`, `RiskEvent.analysisSessionId`, `RiskEvent.riskPolicyId`, `RiskEvent.idempotencyKey`, `RiskEvent.schemaVersion`, `RiskEvent.eventSequence`, `RiskEvent.priorState`, `RiskEvent.state`, `RiskEvent.transitionReasonCode`, `RiskEvent.policyKey`, `RiskEvent.policyVersion`, `RiskEvent.thresholdVersion`, `RiskEvent.occurredAt`, `RiskEvent.receivedAt`, `RiskEvent.createdAt` | C2 | R-EVIDENCE | Immutable decision history and version snapshots; no raw conversation or audio. |
| `RiskEventEvidence.id`, `RiskEventEvidence.organizationId`, `RiskEventEvidence.riskEventId`, `RiskEventEvidence.evidenceEventId`, `RiskEventEvidence.createdAt` | C2 | R-EVIDENCE | Minimal provenance link; follows risk/evidence retention. |
| `Intervention.id`, `Intervention.organizationId`, `Intervention.callId`, `Intervention.riskEventId`, `Intervention.resolvedByMembershipId`, `Intervention.idempotencyKey`, `Intervention.type`, `Intervention.status`, `Intervention.policyVersion`, `Intervention.reasonCode`, `Intervention.protectedActionReference`, `Intervention.requiredAt`, `Intervention.acknowledgedAt`, `Intervention.resolvedAt`, `Intervention.expiresAt`, `Intervention.createdAt`, `Intervention.updatedAt` | C2 | R-EVIDENCE | Server-side action/hold proof with opaque external reference, not protected-action data. |
| `VerificationChallenge.id`, `VerificationChallenge.organizationId`, `VerificationChallenge.callId`, `VerificationChallenge.interventionId`, `VerificationChallenge.performedByMembershipId`, `VerificationChallenge.idempotencyKey`, `VerificationChallenge.method`, `VerificationChallenge.status`, `VerificationChallenge.attemptNumber`, `VerificationChallenge.requestedAt`, `VerificationChallenge.completedAt`, `VerificationChallenge.expiresAt`, `VerificationChallenge.resultCode`, `VerificationChallenge.createdAt` | C2 | R-EVIDENCE | Independent verification metadata only; no OTP, answer, callback conversation, or credential. |
| `Alert.id`, `Alert.organizationId`, `Alert.callId`, `Alert.riskEventId`, `Alert.interventionId`, `Alert.idempotencyKey`, `Alert.channel`, `Alert.status`, `Alert.eventType`, `Alert.schemaVersion`, `Alert.recipientReference`, `Alert.attemptCount`, `Alert.nextAttemptAt`, `Alert.deliveredAt`, `Alert.failureCode`, `Alert.createdAt`, `Alert.updatedAt` | C2 | R-EVIDENCE | Delivery metadata for versioned security events; recipient is an opaque authorized reference. |
| `AuditLog.id`, `AuditLog.organizationId`, `AuditLog.actorMembershipId`, `AuditLog.correlationId`, `AuditLog.idempotencyKey`, `AuditLog.action`, `AuditLog.targetType`, `AuditLog.targetId`, `AuditLog.outcome`, `AuditLog.reasonCode`, `AuditLog.occurredAt`, `AuditLog.createdAt` | C2 | R-AUDIT | Append-only security proof; target/actor must be tenant-validated before insert. |
| `AuditLog.sourceIpHash` | C2 | R-AUDIT | Salted/controlled hash where collection is approved; no raw IP in this model. |
| `AuditLog.nonSensitiveMetadata` | C1 | R-AUDIT | Strict allow-list only. Reject conversation content, audio, embeddings, tokens, passwords, secrets, or arbitrary request bodies. |

## Transient-only inventory

| Data | Class | Maximum lifecycle |
|---|---|---|
| Live call/enrollment frames, normalized PCM, rolling windows | C3 | Bounded memory for the active authorized inference/enrollment operation; clear on stop/error/revoke/expiry. |
| Plaintext embeddings and model tensors | C3 | Bounded memory only while the authorized comparison/enrollment calculation runs; clear/release immediately afterward. |
| Access/refresh token plaintext, OTPs, callback answers | C3 | Request/client handling only; persist hashes or outcome metadata where the later contract explicitly requires it. |

## Deletion and revocation verification

- Voiceprint deletion must prove ciphertext is null, no recoverable plaintext/audio was written, dependent sessions cannot use it, and an allow-listed audit event exists.
- Consent revocation must prevent new voiceprint/session authorization before acknowledging success.
- Tenant/account erasure must use an explicit dependency plan; broad cascade deletion is prohibited.
- Evidence/audit deletion must be an authorized policy job with tenant scope, bounded batches, idempotency, and deletion audit evidence.
- Backups, key destruction, and exact retention durations require the Phase U/X legal/security operations contract; `VALIDATION REQUIRED`.
