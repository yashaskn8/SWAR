import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  IdempotencyConflictError,
  TenantResourceNotFoundError,
} from '../../../src/database/database.errors';
import { PrismaService } from '../../../src/database/prisma.service';
import { ConfigurationService } from '../../../src/config/configuration';
import { TransactionService } from '../../../src/database/transaction.service';
import {
  EvidenceMode,
  EvidenceReadiness,
  EvidenceType,
  InterventionType,
  MembershipStatus,
  ModelCapability,
  ModelLifecycleStatus,
  OrganizationRole,
  ParticipantRole,
  RiskState,
  RiskAssessmentOutcome,
  RiskDecisionMode,
  ScoreDirection,
  ScoreTarget,
  type RiskPolicy,
} from '../../../src/generated/prisma/client';
import { AuditRepository } from '../../../src/modules/audit/audit.repository';
import { CallRepository } from '../../../src/modules/calls/call.repository';
import { EnrollmentRepository } from '../../../src/modules/enrollment/enrollment.repository';
import { EvidenceRepository } from '../../../src/modules/evidence/evidence.repository';
import type { RecordEvidenceInput } from '../../../src/modules/evidence/evidence.repository';
import { GovernanceRepository } from '../../../src/modules/governance/governance.repository';
import { IdentityRepository } from '../../../src/modules/identity/identity.repository';
import { RiskRepository } from '../../../src/modules/risk/risk.repository';
import { validTestEnvironment } from '../../test-environment';

const databaseEnabled = process.env.SWAR_RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseEnabled)('Phase F tenant repositories', () => {
  const prisma = databaseEnabled ? new PrismaService() : ({} as PrismaService);
  const transactions = new TransactionService(prisma);
  const audit = new AuditRepository(prisma);
  const identity = new IdentityRepository(prisma, transactions);
  const governance = new GovernanceRepository(prisma, transactions);
  const enrollment = new EnrollmentRepository(prisma, transactions);
  const calls = new CallRepository(prisma, transactions);
  const evidence = new EvidenceRepository(prisma);
  const risk = new RiskRepository(
    prisma,
    transactions,
    audit,
    new ConfigurationService(validTestEnvironment()),
  );

  beforeAll(async () => prisma.onModuleInit());
  afterAll(async () => prisma.onModuleDestroy());

  async function createTenantFixture(prefix: string): Promise<{
    organizationId: string;
    membershipId: string;
    policy: RiskPolicy;
  }> {
    const suffix = randomUUID();
    const organization = await identity.createOrganization({
      slug: `${prefix}-${suffix}`,
      displayName: `Fictional ${prefix} test tenant`,
    });
    const user = await identity.createUser({
      emailCanonical: `${prefix}-${suffix}@example.invalid`,
      passwordHash: 'ARGON2ID_TEST_DOUBLE_NOT_A_REAL_CREDENTIAL',
    });
    const membership = await identity.createMembershipWithRoles(
      { organizationId: organization.id },
      { userId: user.id, roles: [OrganizationRole.OWNER], status: MembershipStatus.ACTIVE },
    );
    const policy = await governance.createRiskPolicy(
      { organizationId: organization.id },
      {
        policyKey: 'default-test-policy',
        version: 'test-v1',
        schemaVersion: 'test-v1',
        policyDocument: { fixture: true, productionEligible: false },
        createdByMembershipId: membership.id,
      },
    );
    return {
      organizationId: organization.id,
      membershipId: membership.id,
      policy: await governance.activateRiskPolicy({ organizationId: organization.id }, policy.id),
    };
  }

  test('persists the complete lifecycle atomically through tenant-scoped repositories', async () => {
    const fixture = await createTenantFixture('lifecycle');
    const context = { organizationId: fixture.organizationId };
    const device = await identity.registerDevice(context, {
      membershipId: fixture.membershipId,
      devicePublicId: `device-${randomUUID()}`,
      label: 'Test-only device',
    });
    const refreshSession = await identity.createRefreshSession(context, {
      membershipId: fixture.membershipId,
      deviceId: device.id,
      tokenHash: `TEST_ONLY_HASH_${randomUUID()}`,
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const model = await governance.registerModelVersion({
      modelName: `fixture-model-${randomUUID()}`,
      version: 'test-only',
      capability: ModelCapability.AUDIO_QUALITY,
      checkpointHashSha256: '1'.repeat(64),
      checkpointSource: 'test-fixture://no-checkpoint',
      checkpointLicense: 'TEST-FIXTURE-NO-CHECKPOINT',
      inputSampleRateHz: 16_000,
      inputChannelCount: 1,
      scoreName: 'not-applicable',
      scoreDirection: ScoreDirection.NOT_APPLICABLE,
      scoreTarget: ScoreTarget.AUDIO_QUALITY,
      status: ModelLifecycleStatus.REJECTED,
    });
    const speaker = await enrollment.createTrustedSpeaker(context, {
      externalReference: `fictional-${randomUUID()}`,
      label: 'Fictional test speaker',
    });
    const consent = await enrollment.grantConsent(context, {
      trustedSpeakerId: speaker.id,
      grantedByMembershipId: fixture.membershipId,
      purposeCode: 'REPOSITORY_TEST',
      noticeVersion: 'test-v1',
    });
    const voiceprint = await enrollment.activateVoiceprint(context, {
      trustedSpeakerId: speaker.id,
      consentId: consent.id,
      modelVersionId: model.id,
      createdByMembershipId: fixture.membershipId,
      envelope: {
        kind: 'encrypted-voiceprint-v1',
        ciphertext: Uint8Array.from([1, 2, 3]),
        encryptionAlgorithm: 'TEST_ENVELOPE_ONLY',
        encryptionKeyVersion: 'test-key-version',
        embeddingFormat: 'test-format',
        sampleCount: 1,
      },
    });
    const call = await calls.createCallWithParticipants(context, {
      roomName: `room-${randomUUID()}`,
      expectedTrustedSpeakerId: speaker.id,
      riskPolicyId: fixture.policy.id,
      riskPolicyVersion: fixture.policy.version,
      createdByMembershipId: fixture.membershipId,
      idempotencyKey: `call-${randomUUID()}`,
      participants: [
        {
          trustedSpeakerId: speaker.id,
          livekitIdentity: `caller-${randomUUID()}`,
          authorizedIdentity: `authorized-${randomUUID()}`,
          role: ParticipantRole.CALLER,
        },
      ],
    });
    const participant = await prisma.client.callParticipant.findFirstOrThrow({
      where: { organizationId: fixture.organizationId, callId: call.id },
    });
    const bound = await calls.bindTrackAndCreateAnalysis(context, {
      callId: call.id,
      participantId: participant.id,
      trackSid: `TR_${randomUUID()}`,
      trackSource: 'MICROPHONE',
      analysisIdempotencyKey: `analysis-${randomUUID()}`,
      analysisExpiresAt: new Date(Date.now() + 60_000),
      voiceprintId: voiceprint.id,
    });
    const evidenceInput: RecordEvidenceInput = {
      callId: call.id,
      analysisSessionId: bound.analysisSession.id,
      trackBindingId: bound.binding.id,
      idempotencyKey: `evidence-${randomUUID()}`,
      schemaVersion: 'test-v1',
      eventSequence: 1n,
      windowSequence: 1n,
      revision: 0,
      evidenceType: EvidenceType.PIPELINE_ERROR,
      evidenceMode: EvidenceMode.SHADOW,
      readiness: EvidenceReadiness.ERROR,
      windowStartMs: 0n,
      windowEndMs: 0n,
      observedAt: new Date(),
      reasonCodes: ['TEST_FIXTURE_NO_INFERENCE'],
      errorCode: 'TEST_FIXTURE_PIPELINE_NOT_RUN',
    };
    const recordedEvidence = await evidence.record(context, evidenceInput);
    expect((await evidence.record(context, evidenceInput)).id).toBe(recordedEvidence.id);
    const concurrentEvidenceInput: RecordEvidenceInput = {
      ...evidenceInput,
      idempotencyKey: `evidence-concurrent-${randomUUID()}`,
      eventSequence: 2n,
      windowSequence: 2n,
    };
    const duplicateResults = await Promise.all([
      evidence.record(context, concurrentEvidenceInput),
      evidence.record(context, concurrentEvidenceInput),
    ]);
    expect(duplicateResults[0].id).toBe(duplicateResults[1].id);
    await expect(
      evidence.record(context, { ...evidenceInput, eventSequence: 3n }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const assessmentIdempotencyKey = `risk-assessment-${randomUUID()}`;
    const assessmentOccurredAt = new Date();
    const assessmentInput = {
      callId: call.id,
      analysisSessionId: bound.analysisSession.id,
      riskPolicyId: fixture.policy.id,
      idempotencyKey: assessmentIdempotencyKey,
      schemaVersion: '1.0.0',
      evidenceSetHashSha256: 'a'.repeat(64),
      evidenceMode: EvidenceMode.SHADOW,
      decisionMode: RiskDecisionMode.SHADOW,
      outcome: RiskAssessmentOutcome.HIGH_RISK,
      priorState: RiskState.UNVERIFIED,
      effectiveState: RiskState.HIGH_RISK,
      transitioned: true,
      productionEligible: false,
      activationSuppressed: true,
      reasonCode: 'PHASE_O_SCIENTIFIC_CALIBRATION_BLOCKED',
      policyKey: fixture.policy.policyKey,
      policyVersion: fixture.policy.version,
      thresholdVersion: 'engineering-fixture-not-calibrated',
      proposedInterventions: [InterventionType.WARN],
      maxWindowSequence: 1n,
      occurredAt: assessmentOccurredAt,
      evidenceEventIds: [recordedEvidence.id],
      audit: {
        correlationId: `correlation-${randomUUID()}`,
        idempotencyKey: `audit-${randomUUID()}`,
      },
    };
    const [assessment, assessmentReplay] = await Promise.all([
      risk.recordAssessment(context, assessmentInput),
      risk.recordAssessment(context, assessmentInput),
    ]);
    expect(assessmentReplay.id).toBe(assessment.id);
    expect(assessment.productionEligible).toBe(false);
    expect(assessment.activationSuppressed).toBe(true);
    await expect(
      risk.recordAssessment(context, {
        ...assessmentInput,
        outcome: RiskAssessmentOutcome.CRITICAL,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    const substitutedPolicy = await governance.createRiskPolicy(context, {
      policyKey: 'substituted-test-policy',
      version: 'substituted-v1',
      schemaVersion: 'test-v1',
      policyDocument: { fixture: true, productionEligible: false },
      createdByMembershipId: fixture.membershipId,
    });
    await expect(
      risk.recordAssessment(context, {
        ...assessmentInput,
        riskPolicyId: substitutedPolicy.id,
        idempotencyKey: `risk-assessment-substituted-policy-${randomUUID()}`,
        evidenceSetHashSha256: 'b'.repeat(64),
        policyKey: substitutedPolicy.policyKey,
        policyVersion: substitutedPolicy.version,
      }),
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(
      risk.recordAssessment(context, {
        ...assessmentInput,
        idempotencyKey: `risk-assessment-substituted-mode-${randomUUID()}`,
        evidenceSetHashSha256: 'c'.repeat(64),
        evidenceMode: EvidenceMode.SIMULATED,
        decisionMode: RiskDecisionMode.ENGINEERING_TEST,
      }),
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(
      risk.recordTransition(context, {
        callId: call.id,
        analysisSessionId: bound.analysisSession.id,
        riskPolicyId: fixture.policy.id,
        idempotencyKey: `blocked-risk-${randomUUID()}`,
        schemaVersion: '1.0.0',
        eventSequence: 1n,
        priorState: RiskState.UNVERIFIED,
        state: RiskState.HIGH_RISK,
        transitionReasonCode: 'TEST_FIXTURE_MUST_BE_BLOCKED',
        policyKey: fixture.policy.policyKey,
        policyVersion: fixture.policy.version,
        thresholdVersion: 'engineering-fixture-not-calibrated',
        occurredAt: new Date(),
        evidenceEventIds: [recordedEvidence.id],
        interventions: [],
        alerts: [],
        audit: {
          correlationId: `correlation-${randomUUID()}`,
          idempotencyKey: `audit-${randomUUID()}`,
        },
      }),
    ).rejects.toThrow(/Production risk activation/iu);
    await calls.endCall(context, call.id);
    await identity.revokeRefreshSession(context, refreshSession.id);
    const deletedVoiceprint = await enrollment.revokeConsentAndDeleteVoiceprint(context, {
      consentId: consent.id,
      voiceprintId: voiceprint.id,
      reasonCode: 'TEST_CLEANUP',
    });
    expect(deletedVoiceprint.ciphertext).toBeNull();

    const counts = await Promise.all([
      prisma.client.organizationMembershipRole.count({
        where: { organizationId: fixture.organizationId },
      }),
      prisma.client.device.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.refreshSession.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.trustedSpeaker.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.enrollmentConsent.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.voiceprint.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.call.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.callParticipant.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.mediaTrack.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.trackBinding.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.analysisSession.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.riskPolicy.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.evidenceEvent.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.riskAssessment.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.riskAssessmentEvidence.count({
        where: { organizationId: fixture.organizationId },
      }),
      prisma.client.riskEvent.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.riskEventEvidence.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.intervention.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.verificationChallenge.count({
        where: { organizationId: fixture.organizationId },
      }),
      prisma.client.alert.count({ where: { organizationId: fixture.organizationId } }),
      prisma.client.auditLog.count({ where: { organizationId: fixture.organizationId } }),
    ]);
    expect(counts.slice(0, 15).every((count) => count >= 1)).toBe(true);
    expect(counts.slice(15, 20)).toEqual([0, 0, 0, 0, 0]);
    expect(counts.at(-1)).toBeGreaterThanOrEqual(1);
  }, 30_000);

  test('blocks cross-tenant reads and composite foreign-key writes', async () => {
    const tenantA = await createTenantFixture('tenant-a');
    const tenantB = await createTenantFixture('tenant-b');
    const call = await calls.createCallWithParticipants(
      { organizationId: tenantA.organizationId },
      {
        roomName: `room-${randomUUID()}`,
        riskPolicyId: tenantA.policy.id,
        riskPolicyVersion: tenantA.policy.version,
        createdByMembershipId: tenantA.membershipId,
        idempotencyKey: `call-${randomUUID()}`,
        participants: [
          {
            livekitIdentity: `caller-${randomUUID()}`,
            authorizedIdentity: `authorized-${randomUUID()}`,
            role: ParticipantRole.CALLER,
          },
        ],
      },
    );
    await expect(
      calls.findTenantCall({ organizationId: tenantB.organizationId }, call.id),
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
    await expect(
      prisma.client.callParticipant.create({
        data: {
          organizationId: tenantB.organizationId,
          callId: call.id,
          livekitIdentity: `cross-tenant-${randomUUID()}`,
          authorizedIdentity: 'cross-tenant-test',
          role: ParticipantRole.OBSERVER,
          authorizedAt: new Date(),
        },
      }),
    ).rejects.toBeDefined();
  });

  test('rolls back atomic work and rejects conflicting idempotency replays', async () => {
    const slug = `rollback-${randomUUID()}`;
    await expect(
      transactions.serializable(async (transaction) => {
        await transaction.organization.create({
          data: { slug, displayName: 'Rollback fixture', status: 'ACTIVE' },
        });
        throw new Error('intentional rollback');
      }),
    ).rejects.toThrow('intentional rollback');
    expect(await prisma.client.organization.count({ where: { slug } })).toBe(0);

    const fixture = await createTenantFixture('idempotency');
    const context = { organizationId: fixture.organizationId };
    const call = await calls.createCallWithParticipants(context, {
      roomName: `room-${randomUUID()}`,
      riskPolicyId: fixture.policy.id,
      riskPolicyVersion: fixture.policy.version,
      createdByMembershipId: fixture.membershipId,
      idempotencyKey: `call-${randomUUID()}`,
      participants: [
        {
          livekitIdentity: `caller-${randomUUID()}`,
          authorizedIdentity: `authorized-${randomUUID()}`,
          role: ParticipantRole.CALLER,
        },
      ],
    });
    await expect(
      calls.createCallWithParticipants(context, {
        roomName: `different-room-${randomUUID()}`,
        riskPolicyId: fixture.policy.id,
        riskPolicyVersion: fixture.policy.version,
        createdByMembershipId: fixture.membershipId,
        idempotencyKey: call.idempotencyKey,
        participants: [
          {
            livekitIdentity: `different-${randomUUID()}`,
            authorizedIdentity: 'different-test',
            role: ParticipantRole.CALLER,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(TenantResourceNotFoundError);
  });

  test('uses stable keyset pagination when a concurrent call is inserted', async () => {
    const fixture = await createTenantFixture('pagination');
    const context = { organizationId: fixture.organizationId };
    const createCall = (key: string) =>
      calls.createCallWithParticipants(context, {
        roomName: `room-${key}-${randomUUID()}`,
        riskPolicyId: fixture.policy.id,
        riskPolicyVersion: fixture.policy.version,
        createdByMembershipId: fixture.membershipId,
        idempotencyKey: `call-${key}-${randomUUID()}`,
        participants: [
          {
            livekitIdentity: `caller-${key}-${randomUUID()}`,
            authorizedIdentity: `authorized-${key}`,
            role: ParticipantRole.CALLER,
          },
        ],
      });
    await createCall('one');
    await createCall('two');
    await createCall('three');
    const firstPage = await calls.listActiveCalls(context, { limit: 2 });
    expect(firstPage.nextCursor).not.toBeNull();
    if (firstPage.nextCursor === null) {
      throw new Error('Expected a keyset cursor for the second page.');
    }
    const inserted = await createCall('concurrent');
    const secondPage = await calls.listActiveCalls(context, {
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    const pageIds = [...firstPage.items, ...secondPage.items].map(({ id }) => id);
    expect(new Set(pageIds).size).toBe(pageIds.length);
    expect(pageIds).not.toContain(inserted.id);
  });
});
