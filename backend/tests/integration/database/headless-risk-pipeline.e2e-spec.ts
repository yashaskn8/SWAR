import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { OperationalTelemetryService } from '../../../src/common/logging/operational-telemetry.service';
import type { SafeLogger } from '../../../src/common/logging/safe-logger.service';
import { ConfigurationService } from '../../../src/config/configuration';
import { PrismaService } from '../../../src/database/prisma.service';
import { TransactionService } from '../../../src/database/transaction.service';
import {
  EvidenceMode,
  EvidenceReadiness,
  EvidenceType,
  MembershipStatus,
  ModelCapability,
  ModelLifecycleStatus,
  OrganizationRole,
  ParticipantRole,
  RiskAssessmentOutcome,
  ScoreDirection,
  ScoreTarget,
  SecurityControlMode,
  type ModelVersion,
} from '../../../src/generated/prisma/client';
import { AuditRepository } from '../../../src/modules/audit/audit.repository';
import { CallRepository } from '../../../src/modules/calls/call.repository';
import { EvidenceRepository } from '../../../src/modules/evidence/evidence.repository';
import type { RecordEvidenceInput } from '../../../src/modules/evidence/evidence.repository';
import { GovernanceRepository } from '../../../src/modules/governance/governance.repository';
import { IdentityRepository } from '../../../src/modules/identity/identity.repository';
import { HeadlessRiskPipelineService } from '../../../src/modules/risk/headless-risk-pipeline.service';
import { RiskActivationGateService } from '../../../src/modules/risk/risk-activation-gate.service';
import { SecurityEventOutboxRepository } from '../../../src/modules/security-events/security-event-outbox.repository';
import { validTestEnvironment } from '../../test-environment';

const databaseEnabled = process.env.SWAR_RUN_DATABASE_TESTS === 'true';

const engineeringPolicy = {
  schemaVersion: '1.0.0',
  activationMode: 'ENGINEERING_ONLY',
  thresholdClassification: 'ENGINEERING_FIXTURE_NOT_CALIBRATED',
  thresholdVersion: 'engineering-fixture-thresholds-v1-not-calibrated',
  calibrationVersion: null,
  quality: {
    minimumScore: 0.5,
    minimumSpeechDurationMs: 1000,
    rejectingReasonCodes: ['SEVERE_CLIPPING', 'DISCONTINUITY'],
  },
  thresholds: {
    identityEnter: 0.7,
    identityClear: 0.6,
    spoofEnter: 0.7,
    spoofClear: 0.6,
  },
  fusion: { fastWeight: 0.2, deepWeight: 0.8 },
  hysteresis: {
    entryConsecutiveWindows: 2,
    clearConsecutiveWindows: 3,
    maximumWindowGap: 0,
  },
  interventions: {
    highRisk: ['WARN'],
    critical: ['WARN', 'HOLD_PROTECTED_ACTION', 'REQUIRE_STEP_UP'],
  },
};

describe.skipIf(!databaseEnabled)('headless atomic evidence-to-intervention loop', () => {
  const prisma = databaseEnabled ? new PrismaService() : ({} as PrismaService);
  const transactions = new TransactionService(prisma);
  const evidence = new EvidenceRepository(prisma);
  const audits = new AuditRepository(prisma);
  const configuration = new ConfigurationService(validTestEnvironment());
  const logger = { event: vi.fn() } as unknown as SafeLogger;
  const telemetry = new OperationalTelemetryService();
  const pipeline = new HeadlessRiskPipelineService(
    transactions,
    evidence,
    audits,
    new RiskActivationGateService(configuration),
    configuration,
    logger,
    telemetry,
  );
  const identity = new IdentityRepository(prisma, transactions);
  const governance = new GovernanceRepository(prisma, transactions);
  const calls = new CallRepository(prisma, transactions);
  const securityOutbox = new SecurityEventOutboxRepository(prisma);
  let models: Record<'identity' | 'fast' | 'deep', ModelVersion>;

  beforeAll(async () => {
    await prisma.onModuleInit();
    const suffix = randomUUID();
    const register = (capability: ModelCapability, scoreTarget: ScoreTarget, marker: string) =>
      governance.registerModelVersion({
        modelName: `FICTIONAL_${marker}_${suffix}`,
        version: 'engineering-fixture-v1',
        capability,
        checkpointHashSha256: marker.repeat(64).slice(0, 64),
        checkpointSource: 'test-fixture://no-checkpoint',
        checkpointLicense: 'TEST-FIXTURE-NO-CHECKPOINT',
        inputSampleRateHz: 16_000,
        inputChannelCount: 1,
        scoreName: `fictional_${marker.toLowerCase()}_raw_score`,
        scoreDirection: ScoreDirection.HIGHER_MEANS_MORE,
        scoreTarget,
        status: ModelLifecycleStatus.ACTIVE,
      });
    models = {
      identity: await register(
        ModelCapability.EXPECTED_SPEAKER_SIMILARITY,
        ScoreTarget.EXPECTED_SPEAKER,
        'a',
      ),
      fast: await register(ModelCapability.FAST_SPOOF, ScoreTarget.SPOOF, 'b'),
      deep: await register(ModelCapability.DEEP_SPOOF, ScoreTarget.SPOOF, 'c'),
    };
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function createScenario(label: string) {
    const suffix = randomUUID();
    const organization = await identity.createOrganization({
      slug: `headless-${label}-${suffix}`,
      displayName: `Fictional ${label} tenant`,
    });
    const user = await identity.createUser({
      emailCanonical: `headless-${label}-${suffix}@example.invalid`,
      passwordHash: 'ARGON2ID_TEST_DOUBLE_NOT_A_REAL_CREDENTIAL',
    });
    const membership = await identity.createMembershipWithRoles(
      { organizationId: organization.id },
      { userId: user.id, roles: [OrganizationRole.OWNER], status: MembershipStatus.ACTIVE },
    );
    const policy = await governance.createRiskPolicy(
      { organizationId: organization.id },
      {
        policyKey: 'headless-engineering-policy',
        version: 'engineering-v1-not-calibrated',
        schemaVersion: '1.0.0',
        policyDocument: engineeringPolicy,
        createdByMembershipId: membership.id,
      },
    );
    const activePolicy = await governance.activateRiskPolicy(
      { organizationId: organization.id },
      policy.id,
    );
    const call = await calls.createCallWithParticipants(
      { organizationId: organization.id },
      {
        roomName: `room-${suffix}`,
        riskPolicyId: activePolicy.id,
        riskPolicyVersion: activePolicy.version,
        createdByMembershipId: membership.id,
        idempotencyKey: `call-${suffix}`,
        protectedActionReference: `DEMO-ACTION-${suffix}`,
        participants: [
          {
            livekitIdentity: `caller-${suffix}`,
            authorizedIdentity: `authorized-${suffix}`,
            role: ParticipantRole.CALLER,
          },
        ],
      },
    );
    const participant = await prisma.client.callParticipant.findFirstOrThrow({
      where: { organizationId: organization.id, callId: call.id },
    });
    const bound = await calls.bindTrackAndCreateAnalysis(
      { organizationId: organization.id },
      {
        callId: call.id,
        participantId: participant.id,
        trackSid: `TR_${suffix}`,
        trackSource: 'MICROPHONE',
        analysisIdempotencyKey: `analysis-${suffix}`,
        analysisExpiresAt: new Date(Date.now() + 60_000),
        evidenceMode: EvidenceMode.SIMULATED,
      },
    );
    return {
      organizationId: organization.id,
      membershipId: membership.id,
      call,
      session: bound.analysisSession,
      binding: bound.binding,
    };
  }

  function scored(
    scenario: Awaited<ReturnType<typeof createScenario>>,
    input: {
      sequence: number;
      window: number;
      evidenceType: EvidenceType;
      score: number;
    },
  ): RecordEvidenceInput {
    const model =
      input.evidenceType === EvidenceType.IDENTITY
        ? models.identity
        : input.evidenceType === EvidenceType.SPOOF_FAST
          ? models.fast
          : models.deep;
    return {
      callId: scenario.call.id,
      analysisSessionId: scenario.session.id,
      trackBindingId: scenario.binding.id,
      modelVersionId: model.id,
      idempotencyKey: `evidence-${randomUUID()}`,
      schemaVersion: '1.1.0',
      evidenceMode: EvidenceMode.SIMULATED,
      eventSequence: BigInt(input.sequence),
      windowSequence: BigInt(input.window),
      revision: input.evidenceType === EvidenceType.SPOOF_DEEP ? 1 : 0,
      evidenceType: input.evidenceType,
      readiness: EvidenceReadiness.READY,
      windowStartMs: BigInt((input.window - 1) * 1000),
      windowEndMs: BigInt((input.window - 1) * 1000 + 4000),
      observedAt: new Date(`2030-01-01T00:00:0${input.window + 3}.000Z`),
      processingLatencyMs: 1,
      speechDurationMs: 4000,
      qualityScore: 0.9,
      reasonCodes: ['NON_SCIENTIFIC_TEST_EVIDENCE'],
      modelName: model.modelName,
      modelVersion: model.version,
      checkpointHashSha256: model.checkpointHashSha256,
      scoreName: model.scoreName,
      scoreDirection: model.scoreDirection,
      rawScore: input.score,
    };
  }

  async function runTwoWindows(
    scenario: Awaited<ReturnType<typeof createScenario>>,
    identityScore: number,
    spoofScore: number,
    deepFirst = false,
  ) {
    let result;
    let transitionResult;
    let sequence = 0;
    for (const window of [1, 2]) {
      const types = deepFirst
        ? [EvidenceType.SPOOF_DEEP, EvidenceType.IDENTITY, EvidenceType.SPOOF_FAST]
        : [EvidenceType.IDENTITY, EvidenceType.SPOOF_FAST];
      for (const evidenceType of types) {
        sequence += 1;
        result = await pipeline.ingestAcceptedEvidence({
          organizationId: scenario.organizationId,
          evidence: scored(scenario, {
            sequence,
            window,
            evidenceType,
            score: evidenceType === EvidenceType.IDENTITY ? identityScore : spoofScore,
          }),
        });
        if (result.riskAssessment.riskEventId !== undefined) transitionResult ??= result;
      }
    }
    if (result === undefined) throw new Error('Scenario emitted no evidence.');
    return transitionResult ?? result;
  }

  test('persists all four headless engineering scenarios without production activation', async () => {
    const trusted = await createScenario('trusted-genuine');
    const trustedResult = await runTwoWindows(trusted, 0.9, 0.1);
    expect(trustedResult.riskAssessment).toMatchObject({
      outcome: RiskAssessmentOutcome.VERIFIED,
      effectiveState: 'VERIFIED',
      mode: SecurityControlMode.DEMO,
      productionEligible: false,
      activationSuppressed: true,
    });

    const unknown = await createScenario('unknown-genuine');
    const unknownResult = await runTwoWindows(unknown, 0.1, 0.1);
    expect(unknownResult.riskAssessment).toMatchObject({
      outcome: RiskAssessmentOutcome.UNVERIFIED,
      effectiveState: 'UNVERIFIED',
      productionEligible: false,
    });
    expect(unknownResult.riskAssessment.interventionIds).toBeUndefined();

    const clone = await createScenario('trusted-clone');
    const cloneResult = await runTwoWindows(clone, 0.9, 0.9, true);
    expect(cloneResult.riskAssessment).toMatchObject({
      outcome: RiskAssessmentOutcome.CRITICAL,
      effectiveState: 'CRITICAL',
      mode: SecurityControlMode.DEMO,
      productionEligible: false,
      activationSuppressed: true,
    });
    expect(cloneResult.riskAssessment.interventionIds).toHaveLength(3);
    expect(cloneResult.riskAssessment.outboxIds).toHaveLength(5);
    const cloneInterventions = await prisma.client.intervention.findMany({
      where: { organizationId: clone.organizationId, callId: clone.call.id },
    });
    expect(cloneInterventions.map(({ mode }) => mode)).toEqual([
      SecurityControlMode.DEMO,
      SecurityControlMode.DEMO,
      SecurityControlMode.DEMO,
    ]);
    expect(cloneInterventions.map(({ type }) => type)).toEqual(
      expect.arrayContaining(['WARN', 'HOLD_PROTECTED_ACTION', 'REQUIRE_STEP_UP']),
    );
    expect(
      await prisma.client.riskEvent.count({
        where: { organizationId: clone.organizationId, mode: SecurityControlMode.PRODUCTION },
      }),
    ).toBe(0);

    const cloneOutbox = await prisma.client.alert.findMany({
      where: { organizationId: clone.organizationId, callId: clone.call.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { riskEvent: true, intervention: true },
    });
    expect(cloneOutbox).toHaveLength(5);
    const firstEventId = cloneOutbox.at(0)?.externalEventId;
    if (firstEventId === null || firstEventId === undefined) {
      throw new Error('Expected a stable external event id.');
    }
    for (const record of cloneOutbox) {
      await prisma.client.alert.update({
        where: { id: record.id },
        data: { attemptCount: 1 },
      });
      if (record.externalEventId === firstEventId) {
        await securityOutbox.acknowledge(
          { organizationId: clone.organizationId },
          clone.membershipId,
          [clone.call.id],
          firstEventId,
        );
      }
      await securityOutbox.markDelivered({ ...record, attemptCount: 1 });
    }
    const replay = await securityOutbox.replay(
      { organizationId: clone.organizationId },
      [clone.call.id],
      firstEventId,
      50,
    );
    expect(replay.status).toBe('COMPLETE');
    expect(replay.events).toHaveLength(4);
    expect(replay.events.every(({ metadata }) => metadata.mode === SecurityControlMode.DEMO)).toBe(
      true,
    );
    await securityOutbox.acknowledge(
      { organizationId: clone.organizationId },
      clone.membershipId,
      [clone.call.id],
      firstEventId,
    );
    expect(
      await prisma.client.alert.findFirstOrThrow({
        where: { organizationId: clone.organizationId, externalEventId: firstEventId },
        select: { acknowledgedAt: true, acknowledgedByMembershipId: true },
      }),
    ).toMatchObject({ acknowledgedByMembershipId: clone.membershipId });
    await expect(
      securityOutbox.acknowledge(
        { organizationId: trusted.organizationId },
        trusted.membershipId,
        [clone.call.id],
        firstEventId,
      ),
    ).rejects.toBeDefined();

    const poor = await createScenario('poor-audio');
    const poorResult = await pipeline.ingestAcceptedEvidence({
      organizationId: poor.organizationId,
      evidence: {
        callId: poor.call.id,
        analysisSessionId: poor.session.id,
        trackBindingId: poor.binding.id,
        idempotencyKey: `evidence-${randomUUID()}`,
        schemaVersion: '1.1.0',
        evidenceMode: EvidenceMode.SIMULATED,
        eventSequence: 1n,
        windowSequence: 1n,
        revision: 0,
        evidenceType: EvidenceType.INSUFFICIENT_EVIDENCE,
        readiness: EvidenceReadiness.INSUFFICIENT,
        windowStartMs: 0n,
        windowEndMs: 4000n,
        observedAt: new Date('2030-01-01T00:00:04.000Z'),
        reasonCodes: ['INADEQUATE_SPEECH'],
      },
    });
    expect(poorResult.riskAssessment).toMatchObject({
      outcome: RiskAssessmentOutcome.INSUFFICIENT_EVIDENCE,
      productionEligible: false,
    });
    expect(
      await prisma.client.intervention.count({ where: { organizationId: poor.organizationId } }),
    ).toBe(0);
  }, 30_000);

  test('coalesces a concurrent replay and rolls back the complete unit on downstream failure', async () => {
    const scenario = await createScenario('atomicity');
    const input = scored(scenario, {
      sequence: 1,
      window: 1,
      evidenceType: EvidenceType.IDENTITY,
      score: 0.9,
    });
    const [first, second] = await Promise.all([
      pipeline.ingestAcceptedEvidence({ organizationId: scenario.organizationId, evidence: input }),
      pipeline.ingestAcceptedEvidence({ organizationId: scenario.organizationId, evidence: input }),
    ]);
    expect(second.evidenceEventId).toBe(first.evidenceEventId);
    expect(second.riskAssessment.riskAssessmentId).toBe(first.riskAssessment.riskAssessmentId);

    const failing = new HeadlessRiskPipelineService(
      transactions,
      evidence,
      { appendWithClient: vi.fn(() => Promise.reject(new Error('TEST_AUDIT_FAILURE'))) } as never,
      new RiskActivationGateService(configuration),
      configuration,
      logger,
      telemetry,
    );
    const rollbackInput = scored(scenario, {
      sequence: 2,
      window: 2,
      evidenceType: EvidenceType.IDENTITY,
      score: 0.9,
    });
    await expect(
      failing.ingestAcceptedEvidence({
        organizationId: scenario.organizationId,
        evidence: rollbackInput,
      }),
    ).rejects.toThrow('TEST_AUDIT_FAILURE');
    expect(
      await prisma.client.evidenceEvent.count({
        where: {
          organizationId: scenario.organizationId,
          idempotencyKey: rollbackInput.idempotencyKey,
        },
      }),
    ).toBe(0);
    expect(
      await prisma.client.riskAssessment.count({
        where: { organizationId: scenario.organizationId, maxWindowSequence: 2n },
      }),
    ).toBe(0);
  }, 30_000);

  test('rejects cross-tenant evidence bindings without persisting a partial row', async () => {
    const tenantA = await createScenario('tenant-a');
    const tenantB = await createScenario('tenant-b');
    const input = scored(tenantA, {
      sequence: 1,
      window: 1,
      evidenceType: EvidenceType.IDENTITY,
      score: 0.9,
    });
    await expect(
      pipeline.ingestAcceptedEvidence({ organizationId: tenantB.organizationId, evidence: input }),
    ).rejects.toBeDefined();
    expect(
      await prisma.client.evidenceEvent.count({
        where: { organizationId: tenantB.organizationId, idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(0);
  });
});
