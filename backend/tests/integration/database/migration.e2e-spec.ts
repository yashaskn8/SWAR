import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PrismaService } from '../../../src/database/prisma.service';

const databaseEnabled = process.env.SWAR_RUN_DATABASE_TESTS === 'true';
const expectedTables = [
  'Alert',
  'AnalysisSession',
  'AuditLog',
  'Call',
  'CallParticipant',
  'Device',
  'EnrollmentConsent',
  'EvidenceEvent',
  'Intervention',
  'MediaTrack',
  'ModelVersion',
  'Organization',
  'OrganizationMembership',
  'OrganizationMembershipRole',
  'RefreshSession',
  'RiskEvent',
  'RiskEventEvidence',
  'RiskPolicy',
  'TrackBinding',
  'TrustedSpeaker',
  'User',
  'VerificationChallenge',
  'Voiceprint',
] as const;

describe.skipIf(!databaseEnabled)('Phase F migration and seed contract', () => {
  const prisma = databaseEnabled ? new PrismaService() : ({} as PrismaService);

  beforeAll(async () => prisma.onModuleInit());
  afterAll(async () => prisma.onModuleDestroy());

  test('applies every checked-in migration and contains every persistent entity', async () => {
    const tables = await prisma.client.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    expect(
      tables.map(({ table_name }) => table_name).filter((name) => !name.startsWith('_')),
    ).toEqual([...expectedTables].sort());

    const migrations = await prisma.client.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    const migrationDirectories = (
      await readdir(resolve('prisma', 'migrations'), {
        withFileTypes: true,
      })
    ).filter((entry) => entry.isDirectory());
    expect(migrations[0]?.count).toBe(BigInt(migrationDirectories.length));
  });

  test('installs the database-native lifecycle and partial uniqueness protections', async () => {
    const constraints = await prisma.client.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conname LIKE '%_check' ORDER BY conname
    `;
    expect(constraints.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        'EvidenceEvent_readiness_check',
        'RiskEvent_transition_check',
        'Voiceprint_sensitive_material_check',
      ]),
    );

    const indexes = await prisma.client.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname LIKE '%_one_active_%'
      ORDER BY indexname
    `;
    expect(indexes.map(({ indexname }) => indexname)).toEqual([
      'RiskPolicy_one_active_per_key_key',
      'TrackBinding_one_active_per_call_key',
      'Voiceprint_one_active_per_speaker_key',
    ]);
  });

  test('seeds one inert record for every entity without retained biometric material', async () => {
    const counts = await Promise.all([
      prisma.client.organization.count(),
      prisma.client.user.count(),
      prisma.client.organizationMembership.count(),
      prisma.client.organizationMembershipRole.count(),
      prisma.client.device.count(),
      prisma.client.refreshSession.count(),
      prisma.client.trustedSpeaker.count(),
      prisma.client.enrollmentConsent.count(),
      prisma.client.voiceprint.count(),
      prisma.client.modelVersion.count(),
      prisma.client.riskPolicy.count(),
      prisma.client.call.count(),
      prisma.client.callParticipant.count(),
      prisma.client.mediaTrack.count(),
      prisma.client.trackBinding.count(),
      prisma.client.analysisSession.count(),
      prisma.client.evidenceEvent.count(),
      prisma.client.riskEvent.count(),
      prisma.client.riskEventEvidence.count(),
      prisma.client.intervention.count(),
      prisma.client.verificationChallenge.count(),
      prisma.client.alert.count(),
      prisma.client.auditLog.count(),
    ]);
    expect(counts.every((count) => count >= 1)).toBe(true);

    const retained = await prisma.client.voiceprint.count({
      where: {
        organizationId: '018f0000-0000-7000-8000-000000000001',
        ciphertext: { not: null },
      },
    });
    expect(retained).toBe(0);
  });

  test('persists no raw-audio-shaped database column', async () => {
    const prohibitedColumns = await prisma.client.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name ~* '(audio|waveform|pcm|tensor|plaintext)'
    `;
    expect(prohibitedColumns).toEqual([]);
  });

  test('rejects invalid lifecycle/evidence transitions at the database boundary', async () => {
    const voiceprintId = '018f0000-0000-7000-8000-000000000010';
    await expect(
      prisma.client.voiceprint.update({
        where: { id: voiceprintId },
        data: { status: 'ACTIVE', activatedAt: new Date(), deletedAt: null, ciphertext: null },
      }),
    ).rejects.toBeDefined();
    expect(
      (await prisma.client.voiceprint.findUniqueOrThrow({ where: { id: voiceprintId } })).status,
    ).toBe('DELETED');

    const evidenceId = '018f0000-0000-7000-8000-000000000017';
    await expect(
      prisma.client.evidenceEvent.update({
        where: { id: evidenceId },
        data: { readiness: 'READY', evidenceType: 'AUDIO_QUALITY', errorCode: null },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.client.evidenceEvent.update({
        where: { id: evidenceId },
        data: { windowStartMs: -1n },
      }),
    ).rejects.toBeDefined();

    const riskEventId = '018f0000-0000-7000-8000-000000000018';
    await expect(
      prisma.client.riskEvent.update({
        where: { id: riskEventId },
        data: { priorState: 'HIGH_RISK' },
      }),
    ).rejects.toBeDefined();
  });

  test('uses the tenant/status/time index for pending alert delivery', async () => {
    const organizationId = '018f0000-0000-7000-8000-000000000001';
    await prisma.client.alert.update({
      where: { id: '018f0000-0000-7000-8000-000000000022' },
      data: { status: 'PENDING', nextAttemptAt: new Date() },
    });
    const plan = await prisma.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return transaction.$queryRawUnsafe<Array<Record<string, unknown>>>(
        'EXPLAIN (FORMAT JSON) SELECT "id" FROM "Alert" WHERE "organizationId" = $1::uuid AND "status" = \'PENDING\' ORDER BY "nextAttemptAt" ASC LIMIT 10',
        organizationId,
      );
    });
    expect(JSON.stringify(plan)).toContain('Alert_organizationId_status_nextAttemptAt_idx');
  });
});
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
