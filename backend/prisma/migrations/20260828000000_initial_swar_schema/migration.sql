-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DELETED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'SECURITY_ANALYST', 'CALL_OPERATOR', 'ENROLLMENT_OPERATOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "RefreshSessionStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TrustedSpeakerStatus" AS ENUM ('PENDING_ENROLLMENT', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'DELETED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VoiceprintStatus" AS ENUM ('ENROLLING', 'ACTIVE', 'REVOKED', 'DELETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('REQUESTED', 'AUTHORIZED', 'ACTIVE', 'ENDING', 'ENDED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('CALLER', 'CUSTOMER', 'OBSERVER', 'ML_SUBSCRIBER');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('AUTHORIZED', 'JOINED', 'DISCONNECTED', 'LEFT', 'REVOKED');

-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('PUBLISHED', 'MUTED', 'UNPUBLISHED', 'ENDED');

-- CreateEnum
CREATE TYPE "TrackBindingStatus" AS ENUM ('AUTHORIZED', 'ACTIVE', 'SUPERSEDED', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AnalysisSessionStatus" AS ENUM ('AUTHORIZED', 'STARTING', 'ACTIVE', 'DEGRADED', 'STOPPING', 'STOPPED', 'FAILED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ModelCapability" AS ENUM ('EXPECTED_SPEAKER_SIMILARITY', 'FAST_SPOOF', 'DEEP_SPOOF', 'AUDIO_QUALITY');

-- CreateEnum
CREATE TYPE "ModelLifecycleStatus" AS ENUM ('REGISTERED', 'VALIDATED', 'ACTIVE', 'RETIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiskPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('IDENTITY', 'SPOOF_FAST', 'SPOOF_DEEP', 'AUDIO_QUALITY', 'INSUFFICIENT_EVIDENCE', 'PIPELINE_ERROR');

-- CreateEnum
CREATE TYPE "EvidenceReadiness" AS ENUM ('READY', 'INSUFFICIENT', 'ERROR');

-- CreateEnum
CREATE TYPE "ScoreDirection" AS ENUM ('HIGHER_MEANS_MORE', 'LOWER_MEANS_MORE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "EvidenceAcceptanceStatus" AS ENUM ('ACCEPTED', 'SUPERSEDED', 'DUPLICATE', 'STALE', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiskState" AS ENUM ('VERIFIED', 'UNVERIFIED', 'HIGH_RISK', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InterventionType" AS ENUM ('WARN', 'HOLD_PROTECTED_ACTION', 'REQUIRE_STEP_UP', 'REQUIRE_CALLBACK', 'END_CALL');

-- CreateEnum
CREATE TYPE "InterventionStatus" AS ENUM ('REQUIRED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SATISFIED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('SECURITY_WEBSOCKET', 'AUDIT_QUEUE', 'FUTURE_ENTERPRISE');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCEEDED', 'DENIED', 'FAILED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "emailCanonical" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "joinedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMembershipRole" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMembershipRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "devicePublicId" VARCHAR(128) NOT NULL,
    "label" VARCHAR(120),
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "familyId" UUID NOT NULL,
    "status" "RefreshSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedSpeaker" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID,
    "externalReference" VARCHAR(128),
    "label" VARCHAR(160) NOT NULL,
    "status" "TrustedSpeakerStatus" NOT NULL DEFAULT 'PENDING_ENROLLMENT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TrustedSpeaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentConsent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "trustedSpeakerId" UUID NOT NULL,
    "grantedByMembershipId" UUID NOT NULL,
    "purposeCode" VARCHAR(80) NOT NULL,
    "noticeVersion" VARCHAR(40) NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "grantedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "revocationReasonCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "EnrollmentConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voiceprint" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "trustedSpeakerId" UUID NOT NULL,
    "consentId" UUID NOT NULL,
    "modelVersionId" UUID NOT NULL,
    "createdByMembershipId" UUID NOT NULL,
    "ciphertext" BYTEA,
    "encryptionAlgorithm" VARCHAR(64) NOT NULL,
    "encryptionKeyVersion" VARCHAR(128) NOT NULL,
    "embeddingFormat" VARCHAR(64) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "status" "VoiceprintStatus" NOT NULL DEFAULT 'ENROLLING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "activatedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Voiceprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" UUID NOT NULL,
    "modelName" VARCHAR(120) NOT NULL,
    "version" VARCHAR(80) NOT NULL,
    "capability" "ModelCapability" NOT NULL,
    "checkpointHashSha256" CHAR(64) NOT NULL,
    "checkpointSource" TEXT NOT NULL,
    "checkpointLicense" VARCHAR(160) NOT NULL,
    "inputSampleRateHz" INTEGER NOT NULL,
    "inputChannelCount" INTEGER NOT NULL,
    "scoreName" VARCHAR(120) NOT NULL,
    "scoreDirection" "ScoreDirection" NOT NULL,
    "calibrationVersion" VARCHAR(80),
    "status" "ModelLifecycleStatus" NOT NULL DEFAULT 'REGISTERED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMPTZ(6),
    "retiredAt" TIMESTAMPTZ(6),

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "roomName" VARCHAR(160) NOT NULL,
    "expectedTrustedSpeakerId" UUID,
    "riskPolicyId" UUID NOT NULL,
    "riskPolicyVersion" VARCHAR(40) NOT NULL,
    "createdByMembershipId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "protectedActionReference" VARCHAR(160),
    "status" "CallStatus" NOT NULL DEFAULT 'REQUESTED',
    "authorizedAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "endedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallParticipant" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "membershipId" UUID,
    "trustedSpeakerId" UUID,
    "livekitIdentity" VARCHAR(160) NOT NULL,
    "authorizedIdentity" VARCHAR(160) NOT NULL,
    "displayName" VARCHAR(160),
    "role" "ParticipantRole" NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "authorizedAt" TIMESTAMPTZ(6) NOT NULL,
    "joinedAt" TIMESTAMPTZ(6),
    "disconnectedAt" TIMESTAMPTZ(6),
    "leftAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaTrack" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "trackSid" VARCHAR(128) NOT NULL,
    "trackSource" VARCHAR(40) NOT NULL,
    "mimeType" VARCHAR(120),
    "status" "TrackStatus" NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MediaTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackBinding" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "mediaTrackId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "TrackBindingStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "authorizedAt" TIMESTAMPTZ(6) NOT NULL,
    "activatedAt" TIMESTAMPTZ(6),
    "endedAt" TIMESTAMPTZ(6),
    "rejectionCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrackBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "trackBindingId" UUID NOT NULL,
    "voiceprintId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "bindingRevision" INTEGER NOT NULL,
    "status" "AnalysisSessionStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "authorizedAt" TIMESTAMPTZ(6) NOT NULL,
    "startedAt" TIMESTAMPTZ(6),
    "stoppedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AnalysisSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskPolicy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "policyKey" VARCHAR(80) NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "schemaVersion" VARCHAR(40) NOT NULL,
    "policyDocument" JSONB NOT NULL,
    "status" "RiskPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByMembershipId" UUID NOT NULL,
    "effectiveAt" TIMESTAMPTZ(6),
    "retiredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "analysisSessionId" UUID NOT NULL,
    "trackBindingId" UUID NOT NULL,
    "modelVersionId" UUID,
    "supersedesEvidenceId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "schemaVersion" VARCHAR(40) NOT NULL,
    "eventSequence" BIGINT NOT NULL,
    "windowSequence" BIGINT NOT NULL,
    "revision" INTEGER NOT NULL,
    "evidenceType" "EvidenceType" NOT NULL,
    "readiness" "EvidenceReadiness" NOT NULL,
    "acceptanceStatus" "EvidenceAcceptanceStatus" NOT NULL DEFAULT 'ACCEPTED',
    "windowStartMs" BIGINT NOT NULL,
    "windowEndMs" BIGINT NOT NULL,
    "observedAt" TIMESTAMPTZ(6) NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingLatencyMs" INTEGER,
    "speechDurationMs" INTEGER,
    "qualityScore" DECIMAL(18,9),
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modelName" VARCHAR(120),
    "modelVersion" VARCHAR(80),
    "checkpointHashSha256" CHAR(64),
    "scoreName" VARCHAR(120),
    "scoreDirection" "ScoreDirection" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "rawScore" DECIMAL(18,9),
    "calibratedScore" DECIMAL(18,9),
    "calibrationVersion" VARCHAR(80),
    "errorCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "analysisSessionId" UUID,
    "riskPolicyId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "schemaVersion" VARCHAR(40) NOT NULL,
    "eventSequence" BIGINT NOT NULL,
    "priorState" "RiskState" NOT NULL,
    "state" "RiskState" NOT NULL,
    "transitionReasonCode" VARCHAR(80) NOT NULL,
    "policyKey" VARCHAR(80) NOT NULL,
    "policyVersion" VARCHAR(40) NOT NULL,
    "thresholdVersion" VARCHAR(80) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEventEvidence" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "riskEventId" UUID NOT NULL,
    "evidenceEventId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEventEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "riskEventId" UUID NOT NULL,
    "resolvedByMembershipId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "type" "InterventionType" NOT NULL,
    "status" "InterventionStatus" NOT NULL DEFAULT 'REQUIRED',
    "policyVersion" VARCHAR(40) NOT NULL,
    "reasonCode" VARCHAR(80) NOT NULL,
    "protectedActionReference" VARCHAR(160),
    "requiredAt" TIMESTAMPTZ(6) NOT NULL,
    "acknowledgedAt" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Intervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationChallenge" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "interventionId" UUID NOT NULL,
    "performedByMembershipId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "method" VARCHAR(80) NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "attemptNumber" INTEGER NOT NULL,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "resultCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "riskEventId" UUID NOT NULL,
    "interventionId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "channel" "AlertChannel" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'PENDING',
    "eventType" VARCHAR(120) NOT NULL,
    "schemaVersion" VARCHAR(40) NOT NULL,
    "recipientReference" VARCHAR(160),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorMembershipId" UUID,
    "correlationId" VARCHAR(128) NOT NULL,
    "idempotencyKey" VARCHAR(128),
    "action" VARCHAR(120) NOT NULL,
    "targetType" VARCHAR(80) NOT NULL,
    "targetId" UUID NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "reasonCode" VARCHAR(80),
    "sourceIpHash" CHAR(64),
    "nonSensitiveMetadata" JSONB,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailCanonical_key" ON "User"("emailCanonical");

-- CreateIndex
CREATE INDEX "OrganizationMembership_userId_status_idx" ON "OrganizationMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "OrganizationMembership_organizationId_status_idx" ON "OrganizationMembership"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_id_key" ON "OrganizationMembership"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "OrganizationMembershipRole_organizationId_role_idx" ON "OrganizationMembershipRole"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembershipRole_organizationId_id_key" ON "OrganizationMembershipRole"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembershipRole_organizationId_membershipId_role_key" ON "OrganizationMembershipRole"("organizationId", "membershipId", "role");

-- CreateIndex
CREATE INDEX "Device_organizationId_membershipId_status_idx" ON "Device"("organizationId", "membershipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Device_organizationId_id_key" ON "Device"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Device_organizationId_devicePublicId_key" ON "Device"("organizationId", "devicePublicId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_organizationId_membershipId_status_idx" ON "RefreshSession"("organizationId", "membershipId", "status");

-- CreateIndex
CREATE INDEX "RefreshSession_organizationId_familyId_status_idx" ON "RefreshSession"("organizationId", "familyId", "status");

-- CreateIndex
CREATE INDEX "RefreshSession_expiresAt_status_idx" ON "RefreshSession"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_organizationId_id_key" ON "RefreshSession"("organizationId", "id");

-- CreateIndex
CREATE INDEX "TrustedSpeaker_organizationId_status_idx" ON "TrustedSpeaker"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedSpeaker_organizationId_id_key" ON "TrustedSpeaker"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedSpeaker_organizationId_externalReference_key" ON "TrustedSpeaker"("organizationId", "externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedSpeaker_organizationId_userId_key" ON "TrustedSpeaker"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "EnrollmentConsent_organizationId_trustedSpeakerId_status_idx" ON "EnrollmentConsent"("organizationId", "trustedSpeakerId", "status");

-- CreateIndex
CREATE INDEX "EnrollmentConsent_expiresAt_status_idx" ON "EnrollmentConsent"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentConsent_organizationId_id_key" ON "EnrollmentConsent"("organizationId", "id");

-- CreateIndex
CREATE INDEX "Voiceprint_organizationId_trustedSpeakerId_status_idx" ON "Voiceprint"("organizationId", "trustedSpeakerId", "status");

-- CreateIndex
CREATE INDEX "Voiceprint_organizationId_consentId_idx" ON "Voiceprint"("organizationId", "consentId");

-- CreateIndex
CREATE INDEX "Voiceprint_modelVersionId_status_idx" ON "Voiceprint"("modelVersionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Voiceprint_organizationId_id_key" ON "Voiceprint"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ModelVersion_capability_status_idx" ON "ModelVersion"("capability", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_modelName_version_checkpointHashSha256_key" ON "ModelVersion"("modelName", "version", "checkpointHashSha256");

-- CreateIndex
CREATE INDEX "Call_organizationId_status_createdAt_idx" ON "Call"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Call_organizationId_expectedTrustedSpeakerId_status_idx" ON "Call"("organizationId", "expectedTrustedSpeakerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Call_organizationId_id_key" ON "Call"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Call_organizationId_roomName_key" ON "Call"("organizationId", "roomName");

-- CreateIndex
CREATE UNIQUE INDEX "Call_organizationId_idempotencyKey_key" ON "Call"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CallParticipant_organizationId_callId_status_idx" ON "CallParticipant"("organizationId", "callId", "status");

-- CreateIndex
CREATE INDEX "CallParticipant_organizationId_authorizedIdentity_idx" ON "CallParticipant"("organizationId", "authorizedIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "CallParticipant_organizationId_id_key" ON "CallParticipant"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CallParticipant_organizationId_callId_id_key" ON "CallParticipant"("organizationId", "callId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CallParticipant_organizationId_callId_livekitIdentity_key" ON "CallParticipant"("organizationId", "callId", "livekitIdentity");

-- CreateIndex
CREATE INDEX "MediaTrack_organizationId_callId_status_idx" ON "MediaTrack"("organizationId", "callId", "status");

-- CreateIndex
CREATE INDEX "MediaTrack_organizationId_participantId_status_idx" ON "MediaTrack"("organizationId", "participantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MediaTrack_organizationId_id_key" ON "MediaTrack"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MediaTrack_organizationId_callId_id_key" ON "MediaTrack"("organizationId", "callId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MediaTrack_organizationId_trackSid_key" ON "MediaTrack"("organizationId", "trackSid");

-- CreateIndex
CREATE INDEX "TrackBinding_organizationId_callId_status_idx" ON "TrackBinding"("organizationId", "callId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrackBinding_organizationId_id_key" ON "TrackBinding"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TrackBinding_organizationId_callId_id_key" ON "TrackBinding"("organizationId", "callId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TrackBinding_organizationId_callId_revision_key" ON "TrackBinding"("organizationId", "callId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TrackBinding_organizationId_mediaTrackId_key" ON "TrackBinding"("organizationId", "mediaTrackId");

-- CreateIndex
CREATE INDEX "AnalysisSession_organizationId_callId_status_idx" ON "AnalysisSession"("organizationId", "callId", "status");

-- CreateIndex
CREATE INDEX "AnalysisSession_expiresAt_status_idx" ON "AnalysisSession"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisSession_organizationId_id_key" ON "AnalysisSession"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisSession_organizationId_callId_id_key" ON "AnalysisSession"("organizationId", "callId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisSession_organizationId_idempotencyKey_key" ON "AnalysisSession"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RiskPolicy_organizationId_status_effectiveAt_idx" ON "RiskPolicy"("organizationId", "status", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskPolicy_organizationId_id_key" ON "RiskPolicy"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiskPolicy_organizationId_policyKey_version_key" ON "RiskPolicy"("organizationId", "policyKey", "version");

-- CreateIndex
CREATE INDEX "EvidenceEvent_organizationId_callId_observedAt_idx" ON "EvidenceEvent"("organizationId", "callId", "observedAt");

-- CreateIndex
CREATE INDEX "EvidenceEvent_organizationId_analysisSessionId_windowSequen_idx" ON "EvidenceEvent"("organizationId", "analysisSessionId", "windowSequence", "acceptanceStatus");

-- CreateIndex
CREATE INDEX "EvidenceEvent_modelVersionId_observedAt_idx" ON "EvidenceEvent"("modelVersionId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceEvent_organizationId_id_key" ON "EvidenceEvent"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceEvent_organizationId_idempotencyKey_key" ON "EvidenceEvent"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceEvent_organizationId_analysisSessionId_eventSequenc_key" ON "EvidenceEvent"("organizationId", "analysisSessionId", "eventSequence");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceEvent_organizationId_analysisSessionId_windowSequen_key" ON "EvidenceEvent"("organizationId", "analysisSessionId", "windowSequence", "evidenceType", "revision");

-- CreateIndex
CREATE INDEX "RiskEvent_organizationId_callId_occurredAt_idx" ON "RiskEvent"("organizationId", "callId", "occurredAt");

-- CreateIndex
CREATE INDEX "RiskEvent_organizationId_state_occurredAt_idx" ON "RiskEvent"("organizationId", "state", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEvent_organizationId_id_key" ON "RiskEvent"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEvent_organizationId_callId_id_key" ON "RiskEvent"("organizationId", "callId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEvent_organizationId_idempotencyKey_key" ON "RiskEvent"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEvent_organizationId_callId_eventSequence_key" ON "RiskEvent"("organizationId", "callId", "eventSequence");

-- CreateIndex
CREATE INDEX "RiskEventEvidence_organizationId_evidenceEventId_idx" ON "RiskEventEvidence"("organizationId", "evidenceEventId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEventEvidence_organizationId_id_key" ON "RiskEventEvidence"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEventEvidence_organizationId_riskEventId_evidenceEventI_key" ON "RiskEventEvidence"("organizationId", "riskEventId", "evidenceEventId");

-- CreateIndex
CREATE INDEX "Intervention_organizationId_callId_status_idx" ON "Intervention"("organizationId", "callId", "status");

-- CreateIndex
CREATE INDEX "Intervention_organizationId_status_requiredAt_idx" ON "Intervention"("organizationId", "status", "requiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Intervention_organizationId_id_key" ON "Intervention"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Intervention_organizationId_callId_id_key" ON "Intervention"("organizationId", "callId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Intervention_organizationId_idempotencyKey_key" ON "Intervention"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "VerificationChallenge_organizationId_callId_status_idx" ON "VerificationChallenge"("organizationId", "callId", "status");

-- CreateIndex
CREATE INDEX "VerificationChallenge_expiresAt_status_idx" ON "VerificationChallenge"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationChallenge_organizationId_id_key" ON "VerificationChallenge"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationChallenge_organizationId_idempotencyKey_key" ON "VerificationChallenge"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationChallenge_organizationId_interventionId_attempt_key" ON "VerificationChallenge"("organizationId", "interventionId", "attemptNumber");

-- CreateIndex
CREATE INDEX "Alert_organizationId_status_nextAttemptAt_idx" ON "Alert"("organizationId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Alert_organizationId_callId_createdAt_idx" ON "Alert"("organizationId", "callId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_organizationId_id_key" ON "Alert"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_organizationId_idempotencyKey_key" ON "Alert"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_occurredAt_idx" ON "AuditLog"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_targetType_targetId_occurredAt_idx" ON "AuditLog"("organizationId", "targetType", "targetId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_correlationId_idx" ON "AuditLog"("organizationId", "correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_organizationId_id_key" ON "AuditLog"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_organizationId_idempotencyKey_key" ON "AuditLog"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembershipRole" ADD CONSTRAINT "OrganizationMembershipRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembershipRole" ADD CONSTRAINT "OrganizationMembershipRole_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_organizationId_deviceId_fkey" FOREIGN KEY ("organizationId", "deviceId") REFERENCES "Device"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedSpeaker" ADD CONSTRAINT "TrustedSpeaker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedSpeaker" ADD CONSTRAINT "TrustedSpeaker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentConsent" ADD CONSTRAINT "EnrollmentConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentConsent" ADD CONSTRAINT "EnrollmentConsent_organizationId_trustedSpeakerId_fkey" FOREIGN KEY ("organizationId", "trustedSpeakerId") REFERENCES "TrustedSpeaker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentConsent" ADD CONSTRAINT "EnrollmentConsent_organizationId_grantedByMembershipId_fkey" FOREIGN KEY ("organizationId", "grantedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voiceprint" ADD CONSTRAINT "Voiceprint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voiceprint" ADD CONSTRAINT "Voiceprint_organizationId_trustedSpeakerId_fkey" FOREIGN KEY ("organizationId", "trustedSpeakerId") REFERENCES "TrustedSpeaker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voiceprint" ADD CONSTRAINT "Voiceprint_organizationId_consentId_fkey" FOREIGN KEY ("organizationId", "consentId") REFERENCES "EnrollmentConsent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voiceprint" ADD CONSTRAINT "Voiceprint_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voiceprint" ADD CONSTRAINT "Voiceprint_organizationId_createdByMembershipId_fkey" FOREIGN KEY ("organizationId", "createdByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_organizationId_expectedTrustedSpeakerId_fkey" FOREIGN KEY ("organizationId", "expectedTrustedSpeakerId") REFERENCES "TrustedSpeaker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_organizationId_riskPolicyId_fkey" FOREIGN KEY ("organizationId", "riskPolicyId") REFERENCES "RiskPolicy"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_organizationId_createdByMembershipId_fkey" FOREIGN KEY ("organizationId", "createdByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_organizationId_trustedSpeakerId_fkey" FOREIGN KEY ("organizationId", "trustedSpeakerId") REFERENCES "TrustedSpeaker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTrack" ADD CONSTRAINT "MediaTrack_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTrack" ADD CONSTRAINT "MediaTrack_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaTrack" ADD CONSTRAINT "MediaTrack_organizationId_callId_participantId_fkey" FOREIGN KEY ("organizationId", "callId", "participantId") REFERENCES "CallParticipant"("organizationId", "callId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackBinding" ADD CONSTRAINT "TrackBinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackBinding" ADD CONSTRAINT "TrackBinding_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackBinding" ADD CONSTRAINT "TrackBinding_organizationId_callId_participantId_fkey" FOREIGN KEY ("organizationId", "callId", "participantId") REFERENCES "CallParticipant"("organizationId", "callId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackBinding" ADD CONSTRAINT "TrackBinding_organizationId_callId_mediaTrackId_fkey" FOREIGN KEY ("organizationId", "callId", "mediaTrackId") REFERENCES "MediaTrack"("organizationId", "callId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSession" ADD CONSTRAINT "AnalysisSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSession" ADD CONSTRAINT "AnalysisSession_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSession" ADD CONSTRAINT "AnalysisSession_organizationId_callId_trackBindingId_fkey" FOREIGN KEY ("organizationId", "callId", "trackBindingId") REFERENCES "TrackBinding"("organizationId", "callId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSession" ADD CONSTRAINT "AnalysisSession_organizationId_voiceprintId_fkey" FOREIGN KEY ("organizationId", "voiceprintId") REFERENCES "Voiceprint"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskPolicy" ADD CONSTRAINT "RiskPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskPolicy" ADD CONSTRAINT "RiskPolicy_organizationId_createdByMembershipId_fkey" FOREIGN KEY ("organizationId", "createdByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_organizationId_callId_analysisSessionId_fkey" FOREIGN KEY ("organizationId", "callId", "analysisSessionId") REFERENCES "AnalysisSession"("organizationId", "callId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_organizationId_callId_trackBindingId_fkey" FOREIGN KEY ("organizationId", "callId", "trackBindingId") REFERENCES "TrackBinding"("organizationId", "callId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_organizationId_supersedesEvidenceId_fkey" FOREIGN KEY ("organizationId", "supersedesEvidenceId") REFERENCES "EvidenceEvent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_organizationId_analysisSessionId_fkey" FOREIGN KEY ("organizationId", "analysisSessionId") REFERENCES "AnalysisSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_organizationId_riskPolicyId_fkey" FOREIGN KEY ("organizationId", "riskPolicyId") REFERENCES "RiskPolicy"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEventEvidence" ADD CONSTRAINT "RiskEventEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEventEvidence" ADD CONSTRAINT "RiskEventEvidence_organizationId_riskEventId_fkey" FOREIGN KEY ("organizationId", "riskEventId") REFERENCES "RiskEvent"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEventEvidence" ADD CONSTRAINT "RiskEventEvidence_organizationId_evidenceEventId_fkey" FOREIGN KEY ("organizationId", "evidenceEventId") REFERENCES "EvidenceEvent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_organizationId_callId_riskEventId_fkey" FOREIGN KEY ("organizationId", "callId", "riskEventId") REFERENCES "RiskEvent"("organizationId", "callId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_organizationId_resolvedByMembershipId_fkey" FOREIGN KEY ("organizationId", "resolvedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "VerificationChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "VerificationChallenge_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "VerificationChallenge_organizationId_callId_interventionId_fkey" FOREIGN KEY ("organizationId", "callId", "interventionId") REFERENCES "Intervention"("organizationId", "callId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "VerificationChallenge_organizationId_performedByMembership_fkey" FOREIGN KEY ("organizationId", "performedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_callId_fkey" FOREIGN KEY ("organizationId", "callId") REFERENCES "Call"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_callId_riskEventId_fkey" FOREIGN KEY ("organizationId", "callId", "riskEventId") REFERENCES "RiskEvent"("organizationId", "callId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "Intervention"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_actorMembershipId_fkey" FOREIGN KEY ("organizationId", "actorMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-native integrity constraints not expressible in the Prisma schema.
ALTER TABLE "User" ADD CONSTRAINT "User_deleted_state_check"
CHECK (("status" = 'DELETED' AND "deletedAt" IS NOT NULL) OR ("status" <> 'DELETED' AND "deletedAt" IS NULL));

ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_lifecycle_check"
CHECK (("status" = 'ACTIVE' AND "joinedAt" IS NOT NULL AND "revokedAt" IS NULL) OR
       ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL) OR
       ("status" IN ('INVITED', 'SUSPENDED')));

ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_lifecycle_check"
CHECK ("expiresAt" > "issuedAt" AND
       (("status" = 'ROTATED' AND "rotatedAt" IS NOT NULL) OR "status" <> 'ROTATED') AND
       (("status" = 'REVOKED' AND "revokedAt" IS NOT NULL) OR "status" <> 'REVOKED'));

ALTER TABLE "TrustedSpeaker" ADD CONSTRAINT "TrustedSpeaker_lifecycle_check"
CHECK (("status" = 'DELETED' AND "deletedAt" IS NOT NULL) OR
       ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "deletedAt" IS NULL) OR
       ("status" NOT IN ('DELETED', 'REVOKED') AND "deletedAt" IS NULL));

ALTER TABLE "EnrollmentConsent" ADD CONSTRAINT "EnrollmentConsent_lifecycle_check"
CHECK (("status" = 'GRANTED' AND "revokedAt" IS NULL) OR
       ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revocationReasonCode" IS NOT NULL) OR
       ("status" = 'EXPIRED' AND "expiresAt" IS NOT NULL));

ALTER TABLE "Voiceprint" ADD CONSTRAINT "Voiceprint_sensitive_material_check"
CHECK ("sampleCount" >= 0 AND
       (("status" = 'ACTIVE' AND "ciphertext" IS NOT NULL AND "activatedAt" IS NOT NULL AND "deletedAt" IS NULL) OR
        ("status" = 'DELETED' AND "ciphertext" IS NULL AND "deletedAt" IS NOT NULL) OR
        ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "deletedAt" IS NULL) OR
        ("status" IN ('ENROLLING', 'FAILED') AND "deletedAt" IS NULL)));

ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_metadata_check"
CHECK ("inputSampleRateHz" > 0 AND "inputChannelCount" > 0 AND
       "checkpointHashSha256" ~ '^[0-9a-f]{64}$' AND
       btrim("checkpointSource") <> '' AND btrim("checkpointLicense") <> '');

ALTER TABLE "Call" ADD CONSTRAINT "Call_lifecycle_check"
CHECK ((("status" IN ('AUTHORIZED', 'ACTIVE', 'ENDING', 'ENDED')) AND "authorizedAt" IS NOT NULL) OR
       "status" IN ('REQUESTED', 'CANCELLED', 'FAILED'));

ALTER TABLE "MediaTrack" ADD CONSTRAINT "MediaTrack_lifecycle_check"
CHECK (("status" = 'ENDED' AND "endedAt" IS NOT NULL) OR "status" <> 'ENDED');

ALTER TABLE "TrackBinding" ADD CONSTRAINT "TrackBinding_lifecycle_check"
CHECK ("revision" >= 0 AND
       (("status" = 'ACTIVE' AND "activatedAt" IS NOT NULL AND "endedAt" IS NULL) OR
        ("status" IN ('SUPERSEDED', 'REVOKED') AND "endedAt" IS NOT NULL) OR
        ("status" = 'REJECTED' AND "rejectionCode" IS NOT NULL) OR
        "status" = 'AUTHORIZED'));

ALTER TABLE "AnalysisSession" ADD CONSTRAINT "AnalysisSession_lifecycle_check"
CHECK ("bindingRevision" >= 0 AND "expiresAt" > "authorizedAt" AND
       (("status" IN ('STOPPED', 'FAILED', 'EXPIRED', 'REVOKED') AND "stoppedAt" IS NOT NULL) OR
        "status" NOT IN ('STOPPED', 'FAILED', 'EXPIRED', 'REVOKED')));

ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_window_check"
CHECK ("eventSequence" >= 0 AND "windowSequence" >= 0 AND "revision" >= 0 AND
       "windowStartMs" >= 0 AND "windowEndMs" >= "windowStartMs" AND
       ("processingLatencyMs" IS NULL OR "processingLatencyMs" >= 0) AND
       ("speechDurationMs" IS NULL OR "speechDurationMs" >= 0) AND
       ("checkpointHashSha256" IS NULL OR "checkpointHashSha256" ~ '^[0-9a-f]{64}$'));

ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_readiness_check"
CHECK (("readiness" = 'READY' AND "evidenceType" NOT IN ('INSUFFICIENT_EVIDENCE', 'PIPELINE_ERROR') AND
        "modelVersionId" IS NOT NULL AND "modelName" IS NOT NULL AND "modelVersion" IS NOT NULL AND
        "checkpointHashSha256" IS NOT NULL AND "scoreName" IS NOT NULL AND "rawScore" IS NOT NULL AND
        "errorCode" IS NULL) OR
       ("readiness" = 'INSUFFICIENT' AND "evidenceType" = 'INSUFFICIENT_EVIDENCE' AND
        "rawScore" IS NULL AND "calibratedScore" IS NULL AND "errorCode" IS NULL) OR
       ("readiness" = 'ERROR' AND "evidenceType" = 'PIPELINE_ERROR' AND
        "rawScore" IS NULL AND "calibratedScore" IS NULL AND "errorCode" IS NOT NULL));

ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_calibration_check"
CHECK ("calibratedScore" IS NULL OR "calibrationVersion" IS NOT NULL);

ALTER TABLE "RiskEvent" ADD CONSTRAINT "RiskEvent_transition_check"
CHECK ("eventSequence" >= 0 AND "priorState" <> "state" AND
       btrim("transitionReasonCode") <> '' AND btrim("policyVersion") <> '' AND btrim("thresholdVersion") <> '');

ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_lifecycle_check"
CHECK (("status" IN ('SATISFIED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'FAILED') AND "resolvedAt" IS NOT NULL) OR
       ("status" NOT IN ('SATISFIED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'FAILED')));

ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "VerificationChallenge_attempt_check"
CHECK ("attemptNumber" >= 1 AND "expiresAt" > "requestedAt");

ALTER TABLE "Alert" ADD CONSTRAINT "Alert_lifecycle_check"
CHECK ("attemptCount" >= 0 AND
       (("status" = 'DELIVERED' AND "deliveredAt" IS NOT NULL) OR "status" <> 'DELIVERED'));

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_source_hash_check"
CHECK ("sourceIpHash" IS NULL OR "sourceIpHash" ~ '^[0-9a-f]{64}$');

-- One active record per tenant-owned lifecycle where the frozen contract requires it.
CREATE UNIQUE INDEX "Voiceprint_one_active_per_speaker_key"
ON "Voiceprint"("organizationId", "trustedSpeakerId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "TrackBinding_one_active_per_call_key"
ON "TrackBinding"("organizationId", "callId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "RiskPolicy_one_active_per_key_key"
ON "RiskPolicy"("organizationId", "policyKey") WHERE "status" = 'ACTIVE';
