import {
  AlertChannel,
  AlertStatus,
  AnalysisSessionStatus,
  AuditOutcome,
  CallStatus,
  ConsentStatus,
  DeviceStatus,
  EvidenceAcceptanceStatus,
  EvidenceReadiness,
  EvidenceType,
  InterventionStatus,
  InterventionType,
  MembershipStatus,
  ModelCapability,
  ModelLifecycleStatus,
  OrganizationRole,
  ParticipantRole,
  ParticipantStatus,
  RefreshSessionStatus,
  RiskPolicyStatus,
  RiskState,
  ScoreDirection,
  TrackBindingStatus,
  TrackStatus,
  TrustedSpeakerStatus,
  UserStatus,
  VerificationStatus,
  VoiceprintStatus,
} from '../src/generated/prisma/client';
import { createPrismaClient } from '../src/database/prisma-client.factory';

const allowedSeedModes = new Set(['development', 'test']);
const mode = process.env.SWAR_ENV?.trim().toLowerCase();

if (mode === undefined || !allowedSeedModes.has(mode)) {
  throw new Error('Seed refused: SWAR_ENV must be development or test.');
}

const ids = {
  organization: '018f0000-0000-7000-8000-000000000001',
  user: '018f0000-0000-7000-8000-000000000002',
  membership: '018f0000-0000-7000-8000-000000000003',
  membershipRole: '018f0000-0000-7000-8000-000000000004',
  device: '018f0000-0000-7000-8000-000000000005',
  refreshSession: '018f0000-0000-7000-8000-000000000006',
  trustedSpeaker: '018f0000-0000-7000-8000-000000000007',
  consent: '018f0000-0000-7000-8000-000000000008',
  modelVersion: '018f0000-0000-7000-8000-000000000009',
  voiceprint: '018f0000-0000-7000-8000-000000000010',
  riskPolicy: '018f0000-0000-7000-8000-000000000011',
  call: '018f0000-0000-7000-8000-000000000012',
  participant: '018f0000-0000-7000-8000-000000000013',
  mediaTrack: '018f0000-0000-7000-8000-000000000014',
  trackBinding: '018f0000-0000-7000-8000-000000000015',
  analysisSession: '018f0000-0000-7000-8000-000000000016',
  evidenceEvent: '018f0000-0000-7000-8000-000000000017',
  riskEvent: '018f0000-0000-7000-8000-000000000018',
  riskEventEvidence: '018f0000-0000-7000-8000-000000000019',
  intervention: '018f0000-0000-7000-8000-000000000020',
  verificationChallenge: '018f0000-0000-7000-8000-000000000021',
  alert: '018f0000-0000-7000-8000-000000000022',
  auditLog: '018f0000-0000-7000-8000-000000000023',
} as const;

const issuedAt = new Date('2026-01-15T10:00:00.000Z');
const endedAt = new Date('2026-01-15T10:05:00.000Z');
const expiresAt = new Date('2026-01-15T11:00:00.000Z');

async function seed(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    await prisma.organization.upsert({
      where: { id: ids.organization },
      update: {},
      create: {
        id: ids.organization,
        slug: 'phase-f-fixture',
        displayName: 'Fictional Phase F Tenant',
        status: 'INACTIVE_TEST_FIXTURE',
      },
    });
    await prisma.user.upsert({
      where: { id: ids.user },
      update: {},
      create: {
        id: ids.user,
        emailCanonical: 'disabled-fixture@example.invalid',
        passwordHash: 'DISABLED_TEST_ACCOUNT_NO_LOGIN',
        status: UserStatus.DISABLED,
      },
    });
    await prisma.organizationMembership.upsert({
      where: { id: ids.membership },
      update: {},
      create: {
        id: ids.membership,
        organizationId: ids.organization,
        userId: ids.user,
        status: MembershipStatus.ACTIVE,
        joinedAt: issuedAt,
      },
    });
    await prisma.organizationMembershipRole.upsert({
      where: { id: ids.membershipRole },
      update: {},
      create: {
        id: ids.membershipRole,
        organizationId: ids.organization,
        membershipId: ids.membership,
        role: OrganizationRole.SECURITY_ANALYST,
        assignedAt: issuedAt,
      },
    });
    await prisma.device.upsert({
      where: { id: ids.device },
      update: {},
      create: {
        id: ids.device,
        organizationId: ids.organization,
        membershipId: ids.membership,
        devicePublicId: 'phase-f-disabled-device',
        label: 'Non-production fixture device',
        status: DeviceStatus.REVOKED,
        revokedAt: endedAt,
      },
    });
    await prisma.refreshSession.upsert({
      where: { id: ids.refreshSession },
      update: {},
      create: {
        id: ids.refreshSession,
        organizationId: ids.organization,
        membershipId: ids.membership,
        deviceId: ids.device,
        tokenHash: 'NON_SECRET_IRREVERSIBLE_TEST_FIXTURE_HASH',
        familyId: '018f0000-0000-7000-8000-000000000024',
        status: RefreshSessionStatus.EXPIRED,
        issuedAt,
        expiresAt,
      },
    });
    await prisma.trustedSpeaker.upsert({
      where: { id: ids.trustedSpeaker },
      update: {},
      create: {
        id: ids.trustedSpeaker,
        organizationId: ids.organization,
        externalReference: 'deleted-fictional-speaker',
        label: 'Deleted fictional speaker fixture',
        status: TrustedSpeakerStatus.DELETED,
        deletedAt: endedAt,
      },
    });
    await prisma.enrollmentConsent.upsert({
      where: { id: ids.consent },
      update: {},
      create: {
        id: ids.consent,
        organizationId: ids.organization,
        trustedSpeakerId: ids.trustedSpeaker,
        grantedByMembershipId: ids.membership,
        purposeCode: 'PHASE_F_SCHEMA_TEST',
        noticeVersion: 'fixture-v1',
        status: ConsentStatus.REVOKED,
        grantedAt: issuedAt,
        revokedAt: endedAt,
        revocationReasonCode: 'FIXTURE_CLEANUP',
      },
    });
    await prisma.modelVersion.upsert({
      where: { id: ids.modelVersion },
      update: {},
      create: {
        id: ids.modelVersion,
        modelName: 'fixture-model-no-checkpoint',
        version: '0-test-only',
        capability: ModelCapability.AUDIO_QUALITY,
        checkpointHashSha256: '0'.repeat(64),
        checkpointSource: 'test-fixture://no-checkpoint',
        checkpointLicense: 'TEST-FIXTURE-NO-CHECKPOINT',
        inputSampleRateHz: 16_000,
        inputChannelCount: 1,
        scoreName: 'not-applicable',
        scoreDirection: ScoreDirection.NOT_APPLICABLE,
        status: ModelLifecycleStatus.REJECTED,
      },
    });
    await prisma.voiceprint.upsert({
      where: { id: ids.voiceprint },
      update: {},
      create: {
        id: ids.voiceprint,
        organizationId: ids.organization,
        trustedSpeakerId: ids.trustedSpeaker,
        consentId: ids.consent,
        modelVersionId: ids.modelVersion,
        createdByMembershipId: ids.membership,
        ciphertext: null,
        encryptionAlgorithm: 'NOT_APPLICABLE_DELETED_FIXTURE',
        encryptionKeyVersion: 'none-fixture',
        embeddingFormat: 'none-fixture',
        sampleCount: 0,
        status: VoiceprintStatus.DELETED,
        revokedAt: endedAt,
        deletedAt: endedAt,
      },
    });
    await prisma.riskPolicy.upsert({
      where: { id: ids.riskPolicy },
      update: {},
      create: {
        id: ids.riskPolicy,
        organizationId: ids.organization,
        policyKey: 'phase-f-fixture',
        version: '0-test-only',
        schemaVersion: 'fixture-v1',
        policyDocument: { fixture: true, productionEligible: false },
        status: RiskPolicyStatus.RETIRED,
        createdByMembershipId: ids.membership,
        retiredAt: endedAt,
      },
    });
    await prisma.call.upsert({
      where: { id: ids.call },
      update: {},
      create: {
        id: ids.call,
        organizationId: ids.organization,
        roomName: 'phase-f-ended-fixture-room',
        expectedTrustedSpeakerId: ids.trustedSpeaker,
        riskPolicyId: ids.riskPolicy,
        riskPolicyVersion: '0-test-only',
        createdByMembershipId: ids.membership,
        idempotencyKey: 'phase-f-fixture-call',
        status: CallStatus.ENDED,
        authorizedAt: issuedAt,
        startedAt: issuedAt,
        endedAt,
      },
    });
    await prisma.callParticipant.upsert({
      where: { id: ids.participant },
      update: {},
      create: {
        id: ids.participant,
        organizationId: ids.organization,
        callId: ids.call,
        trustedSpeakerId: ids.trustedSpeaker,
        livekitIdentity: 'fixture-caller',
        authorizedIdentity: 'fixture-caller-authorized',
        role: ParticipantRole.CALLER,
        status: ParticipantStatus.LEFT,
        authorizedAt: issuedAt,
        joinedAt: issuedAt,
        leftAt: endedAt,
      },
    });
    await prisma.mediaTrack.upsert({
      where: { id: ids.mediaTrack },
      update: {},
      create: {
        id: ids.mediaTrack,
        organizationId: ids.organization,
        callId: ids.call,
        participantId: ids.participant,
        trackSid: 'TR_FIXTURE_ENDED',
        trackSource: 'MICROPHONE',
        mimeType: 'audio/opus',
        status: TrackStatus.ENDED,
        publishedAt: issuedAt,
        endedAt,
      },
    });
    await prisma.trackBinding.upsert({
      where: { id: ids.trackBinding },
      update: {},
      create: {
        id: ids.trackBinding,
        organizationId: ids.organization,
        callId: ids.call,
        participantId: ids.participant,
        mediaTrackId: ids.mediaTrack,
        revision: 1,
        status: TrackBindingStatus.REVOKED,
        authorizedAt: issuedAt,
        activatedAt: issuedAt,
        endedAt,
      },
    });
    await prisma.analysisSession.upsert({
      where: { id: ids.analysisSession },
      update: {},
      create: {
        id: ids.analysisSession,
        organizationId: ids.organization,
        callId: ids.call,
        trackBindingId: ids.trackBinding,
        voiceprintId: ids.voiceprint,
        idempotencyKey: 'phase-f-fixture-analysis',
        bindingRevision: 1,
        status: AnalysisSessionStatus.STOPPED,
        authorizedAt: issuedAt,
        startedAt: issuedAt,
        stoppedAt: endedAt,
        expiresAt,
      },
    });
    await prisma.evidenceEvent.upsert({
      where: { id: ids.evidenceEvent },
      update: {},
      create: {
        id: ids.evidenceEvent,
        organizationId: ids.organization,
        callId: ids.call,
        analysisSessionId: ids.analysisSession,
        trackBindingId: ids.trackBinding,
        idempotencyKey: 'phase-f-fixture-evidence',
        schemaVersion: 'fixture-v1',
        eventSequence: 1n,
        windowSequence: 1n,
        revision: 0,
        evidenceType: EvidenceType.PIPELINE_ERROR,
        readiness: EvidenceReadiness.ERROR,
        acceptanceStatus: EvidenceAcceptanceStatus.ACCEPTED,
        windowStartMs: 0n,
        windowEndMs: 0n,
        observedAt: issuedAt,
        reasonCodes: ['NON_PRODUCTION_FIXTURE'],
        scoreDirection: ScoreDirection.NOT_APPLICABLE,
        errorCode: 'FIXTURE_PIPELINE_NOT_RUN',
      },
    });
    await prisma.riskEvent.upsert({
      where: { id: ids.riskEvent },
      update: {},
      create: {
        id: ids.riskEvent,
        organizationId: ids.organization,
        callId: ids.call,
        analysisSessionId: ids.analysisSession,
        riskPolicyId: ids.riskPolicy,
        idempotencyKey: 'phase-f-fixture-risk-event',
        schemaVersion: 'fixture-v1',
        eventSequence: 1n,
        priorState: RiskState.UNVERIFIED,
        state: RiskState.HIGH_RISK,
        transitionReasonCode: 'FIXTURE_ORCHESTRATION_ONLY',
        policyKey: 'phase-f-fixture',
        policyVersion: '0-test-only',
        thresholdVersion: 'none-fixture',
        occurredAt: issuedAt,
      },
    });
    await prisma.riskEventEvidence.upsert({
      where: { id: ids.riskEventEvidence },
      update: {},
      create: {
        id: ids.riskEventEvidence,
        organizationId: ids.organization,
        riskEventId: ids.riskEvent,
        evidenceEventId: ids.evidenceEvent,
      },
    });
    await prisma.intervention.upsert({
      where: { id: ids.intervention },
      update: {},
      create: {
        id: ids.intervention,
        organizationId: ids.organization,
        callId: ids.call,
        riskEventId: ids.riskEvent,
        idempotencyKey: 'phase-f-fixture-intervention',
        type: InterventionType.WARN,
        status: InterventionStatus.CANCELLED,
        policyVersion: '0-test-only',
        reasonCode: 'FIXTURE_CLEANUP',
        requiredAt: issuedAt,
        resolvedAt: endedAt,
      },
    });
    await prisma.verificationChallenge.upsert({
      where: { id: ids.verificationChallenge },
      update: {},
      create: {
        id: ids.verificationChallenge,
        organizationId: ids.organization,
        callId: ids.call,
        interventionId: ids.intervention,
        idempotencyKey: 'phase-f-fixture-verification',
        method: 'NON_PRODUCTION_FIXTURE',
        status: VerificationStatus.CANCELLED,
        attemptNumber: 1,
        requestedAt: issuedAt,
        completedAt: endedAt,
        expiresAt,
        resultCode: 'FIXTURE_CLEANUP',
      },
    });
    await prisma.alert.upsert({
      where: { id: ids.alert },
      update: {},
      create: {
        id: ids.alert,
        organizationId: ids.organization,
        callId: ids.call,
        riskEventId: ids.riskEvent,
        interventionId: ids.intervention,
        idempotencyKey: 'phase-f-fixture-alert',
        channel: AlertChannel.AUDIT_QUEUE,
        status: AlertStatus.CANCELLED,
        eventType: 'fixture.cancelled',
        schemaVersion: 'fixture-v1',
      },
    });
    await prisma.auditLog.upsert({
      where: { id: ids.auditLog },
      update: {},
      create: {
        id: ids.auditLog,
        organizationId: ids.organization,
        actorMembershipId: ids.membership,
        correlationId: 'phase-f-fixture-correlation',
        idempotencyKey: 'phase-f-fixture-audit',
        action: 'phase-f.fixture.seeded',
        targetType: 'Organization',
        targetId: ids.organization,
        outcome: AuditOutcome.SUCCEEDED,
        nonSensitiveMetadata: { fixture: true, containsBiometricMaterial: false },
        occurredAt: endedAt,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

void seed();
