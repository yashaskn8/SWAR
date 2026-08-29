import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '..');
const readRepositoryFile = (path: string): string =>
  readFileSync(resolve(repositoryRoot, path), 'utf8');

const schema = readRepositoryFile('backend/prisma/schema.prisma');
const domainModel = readRepositoryFile('docs/data/domain-model.md');
const stateMachines = readRepositoryFile('docs/data/state-machines.md');
const retention = readRepositoryFile('docs/data/data-classification-retention.md');
const indexPlan = readRepositoryFile('docs/data/index-and-constraint-plan.md');

const enumNames = new Set([...schema.matchAll(/^enum\s+(\w+)\s*\{/gmu)].map((match) => match[1]!));
const scalarTypes = new Set([
  'String',
  'Int',
  'BigInt',
  'Boolean',
  'DateTime',
  'Decimal',
  'Bytes',
  'Json',
]);

const modelBlocks = new Map(
  [...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gmu)].map(
    (match) => [match[1]!, match[2]!] as const,
  ),
);

const persistedFields = (block: string): string[] =>
  block
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('@@'))
    .flatMap((line) => {
      const [name, declaredType] = line.split(/\s+/u);
      const baseType = declaredType?.replace(/[?[\]]/gu, '');
      return name !== undefined &&
        baseType !== undefined &&
        (scalarTypes.has(baseType) || enumNames.has(baseType))
        ? [name]
        : [];
    });

const tenantModels = [
  'OrganizationMembership',
  'OrganizationMembershipRole',
  'Device',
  'RefreshSession',
  'TrustedSpeaker',
  'EnrollmentConsent',
  'Voiceprint',
  'Call',
  'CallParticipant',
  'MediaTrack',
  'TrackBinding',
  'AnalysisSession',
  'RiskPolicy',
  'EvidenceEvent',
  'RiskEvent',
  'RiskEventEvidence',
  'Intervention',
  'VerificationChallenge',
  'Alert',
  'AuditLog',
] as const;

describe('Phase E domain schema and documentation contract', () => {
  test('contains the complete frozen entity inventory', () => {
    const expectedModels = [
      'Organization',
      'User',
      ...tenantModels.slice(0, 7),
      'ModelVersion',
      ...tenantModels.slice(7),
    ];

    expect([...modelBlocks.keys()].sort()).toEqual([...expectedModels].sort());
    for (const model of expectedModels) {
      expect(domainModel).toContain(`### ${model}`);
    }
  });

  test('gives every tenant model an organization key and tenant candidate key', () => {
    for (const model of tenantModels) {
      const block = modelBlocks.get(model);
      expect(block, `${model} must exist`).toBeDefined();
      expect(block, `${model} must carry organizationId`).toMatch(/^\s*organizationId\s+String/mu);
      expect(block, `${model} must expose a tenant-aware referenced key`).toMatch(
        /@@unique\(\[organizationId, id\]\)/u,
      );
    }
  });

  test('classifies every persisted field with an explicit retention rule', () => {
    for (const [model, block] of modelBlocks) {
      for (const field of persistedFields(block)) {
        expect(retention, `Missing classification for ${model}.${field}`).toContain(
          `\`${model}.${field}\``,
        );
      }
    }
  });

  test('persists no audio, waveform, PCM, tensor, or plaintext embedding field', () => {
    const persistedIdentifiers = [...modelBlocks].flatMap(([model, block]) => [
      model,
      ...persistedFields(block),
    ]);

    for (const identifier of persistedIdentifiers) {
      expect(identifier).not.toMatch(/audio|waveform|pcm|tensor|plaintext/iu);
    }

    const voiceprint = modelBlocks.get('Voiceprint') ?? '';
    expect(voiceprint).toMatch(/ciphertext\s+Bytes\?/u);
    expect(voiceprint).toContain('encryptionKeyVersion');
    expect(voiceprint).toContain('modelVersionId');
  });

  test('freezes approved risk states and replay-safe evidence ordering', () => {
    const riskState = schema.match(/^enum RiskState\s+\{([\s\S]*?)^\}/mu)?.[1];
    expect(riskState?.match(/^\s+[A-Z_]+$/gmu)?.map((value) => value.trim())).toEqual([
      'VERIFIED',
      'UNVERIFIED',
      'HIGH_RISK',
      'CRITICAL',
    ]);

    const evidence = modelBlocks.get('EvidenceEvent') ?? '';
    expect(evidence).toContain('@@unique([organizationId, idempotencyKey])');
    expect(evidence).toContain('@@unique([organizationId, analysisSessionId, eventSequence])');
    expect(evidence).toContain(
      '@@unique([organizationId, analysisSessionId, windowSequence, evidenceType, revision])',
    );
    for (const field of [
      'checkpointHashSha256',
      'scoreName',
      'scoreDirection',
      'calibrationVersion',
      'processingLatencyMs',
      'readiness',
    ]) {
      expect(evidence).toContain(field);
    }
  });

  test('documents all four orchestration outcomes without scientific claims', () => {
    expect(stateMachines).toContain('Genuine trusted speaker');
    expect(stateMachines).toContain('Unknown genuine speaker');
    expect(stateMachines).toContain('Trusted voice clone');
    expect(stateMachines).toContain('Weak/insufficient audio');
    expect(stateMachines).toContain('`VERIFIED`');
    expect(stateMachines).toContain('`UNVERIFIED`');
    expect(stateMachines).toContain('`CRITICAL`');
    expect(stateMachines).toContain('warning plus server-side hold');
    expect(stateMachines).toContain('no model score, threshold, accuracy, or latency claim');
  });

  test('keeps Phase F-only checks and migrations explicit', () => {
    expect(indexPlan).toContain('No migration exists in Phase E');
    expect(indexPlan).toContain('PARTIAL UNIQUE INDEX');
    expect(indexPlan).toMatch(/tenant-isolation/iu);
    expect(indexPlan).toContain('Voiceprint.status = DELETED');
  });

  test('uses SWAR naming throughout the Phase E contract', () => {
    for (const document of [domainModel, stateMachines, retention, indexPlan]) {
      expect(document).not.toMatch(/\bVIGIL\b/u);
    }
  });
});
