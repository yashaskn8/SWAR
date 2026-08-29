import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../src/app.module';
import { configureApplication } from '../../../src/bootstrap';
import { IdempotencyConflictError } from '../../../src/database/database.errors';
import { PrismaService } from '../../../src/database/prisma.service';
import {
  AnalysisSessionStatus,
  CallStatus,
  EvidenceAcceptanceStatus,
  EvidenceType,
} from '../../../src/generated/prisma/client';
import { CallRepository } from '../../../src/modules/calls/call.repository';
import type { RecordEvidenceInput } from '../../../src/modules/evidence/evidence.repository';
import { EvidenceRepository } from '../../../src/modules/evidence/evidence.repository';
import { DependencyProbeService } from '../../../src/modules/health/dependency-probe.service';
import { setValidTestEnvironment } from '../../test-environment';

const ids = {
  organizationId: '018f0000-0000-7000-8000-000000000002',
  callId: '018f0000-0000-7000-8000-000000000003',
  analysisSessionId: '018f0000-0000-7000-8000-000000000004',
  trackBindingId: '018f0000-0000-7000-8000-000000000005',
};

interface StoredEvent {
  id: string;
  acceptanceStatus: EvidenceAcceptanceStatus;
}

function fingerprint(input: RecordEvidenceInput): string {
  return JSON.stringify(input, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

function stubLabels(scenario: string): string[] {
  return ['PROVIDER_STUB', 'NON_SCIENTIFIC_TEST_EVIDENCE', `SCENARIO_${scenario}`];
}

function evidenceBody(
  eventId: string,
  eventSequence: number,
  eventType: 'FAST' | 'DEEP' | 'INSUFFICIENT_EVIDENCE' | 'PIPELINE_ERROR',
  evidenceType: EvidenceType,
) {
  const ready = eventType === 'FAST' || eventType === 'DEEP';
  return {
    eventType,
    eventId,
    schemaVersion: '1.0.0',
    ...ids,
    eventSequence: String(eventSequence),
    windowSequence: '1',
    revision: eventType === 'DEEP' ? 1 : 0,
    evidenceType,
    windowStartMs: '0',
    windowEndMs: '4000',
    observedAt: '2030-01-01T00:00:04Z',
    reasonCodes: stubLabels('PHASE_M_LOOP'),
    ...(ready
      ? {
          processingLatencyMs: 0,
          modelName: `SWAR_DEVELOPMENT_STUB_${evidenceType}`,
          modelVersion: 'phase-m-development-stub-v1',
          checkpointHashSha256: 'a'.repeat(64),
          scoreName: 'stub_non_scientific_raw_score',
          scoreDirection: 'HIGHER_MEANS_MORE',
          rawScore: 0,
        }
      : {}),
    ...(eventType === 'INSUFFICIENT_EVIDENCE'
      ? { reasonCodes: [...stubLabels('PHASE_M_LOOP'), 'INSUFFICIENT_SPEECH'] }
      : {}),
    ...(eventType === 'PIPELINE_ERROR' ? { errorCode: 'STUB_CONFIGURED_PIPELINE_ERROR' } : {}),
  };
}

describe('Phase M authenticated headless stub evidence loop', () => {
  let app: INestApplication;
  let endpoint: string;
  let callStatus: CallStatus = CallStatus.ACTIVE;
  let sessionStatus: AnalysisSessionStatus = AnalysisSessionStatus.ACTIVE;
  const persisted = new Map<string, { fingerprint: string; event: StoredEvent }>();
  const recordedInputs: RecordEvidenceInput[] = [];

  const findAnalysisGrantContext = vi.fn(() =>
    Promise.resolve({
      call: { id: ids.callId, status: callStatus },
      session: { status: sessionStatus },
      binding: { id: ids.trackBindingId },
    }),
  );
  const record = vi.fn(
    (_context: { organizationId: string }, input: RecordEvidenceInput): Promise<StoredEvent> => {
      const existing = persisted.get(input.idempotencyKey);
      const currentFingerprint = fingerprint(input);
      if (existing !== undefined) {
        if (existing.fingerprint !== currentFingerprint) {
          throw new IdempotencyConflictError();
        }
        return Promise.resolve(existing.event);
      }
      const event = {
        id: input.idempotencyKey,
        acceptanceStatus: input.acceptanceStatus ?? EvidenceAcceptanceStatus.ACCEPTED,
      };
      persisted.set(input.idempotencyKey, { fingerprint: currentFingerprint, event });
      recordedInputs.push(input);
      return Promise.resolve(event);
    },
  );

  beforeAll(async () => {
    setValidTestEnvironment({ API_MUTATION_RATE_LIMIT_MAX: '100' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        client: { $queryRaw: () => Promise.resolve([{ ready: 1 }]) },
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => Promise.resolve(),
      })
      .overrideProvider(CallRepository)
      .useValue({ findAnalysisGrantContext })
      .overrideProvider(EvidenceRepository)
      .useValue({ record })
      .overrideProvider(DependencyProbeService)
      .useValue({ probeMl: () => Promise.resolve(true), probeLiveKit: () => Promise.resolve(true) })
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    endpoint = await app.getUrl();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    callStatus = CallStatus.ACTIVE;
    sessionStatus = AnalysisSessionStatus.ACTIVE;
    persisted.clear();
    recordedInputs.length = 0;
    findAnalysisGrantContext.mockClear();
    record.mockClear();
  });

  async function postEvidence(
    body: ReturnType<typeof evidenceBody>,
    secret = 'ml-internal-secret-for-tests-only-123456',
  ) {
    return request(endpoint)
      .post('/api/v1/internal/ml/evidence')
      .set('Authorization', `Bearer ${secret}`)
      .set('X-SWAR-Service', 'swar-ml')
      .set('Idempotency-Key', body.eventId)
      .send(body);
  }

  it('authenticates and persists FAST, DEEP, insufficient, and error paths in delivery order', async () => {
    const events = [
      evidenceBody('018f0000-0000-7000-8000-000000000011', 1, 'DEEP', EvidenceType.SPOOF_DEEP),
      evidenceBody('018f0000-0000-7000-8000-000000000012', 2, 'FAST', EvidenceType.IDENTITY),
      evidenceBody('018f0000-0000-7000-8000-000000000013', 3, 'FAST', EvidenceType.SPOOF_FAST),
      evidenceBody(
        '018f0000-0000-7000-8000-000000000014',
        4,
        'INSUFFICIENT_EVIDENCE',
        EvidenceType.INSUFFICIENT_EVIDENCE,
      ),
      evidenceBody(
        '018f0000-0000-7000-8000-000000000015',
        5,
        'PIPELINE_ERROR',
        EvidenceType.PIPELINE_ERROR,
      ),
    ];

    for (const event of events) {
      const response = await postEvidence(event);
      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({
        eventId: event.eventId,
        acceptanceStatus: EvidenceAcceptanceStatus.ACCEPTED,
      });
    }

    expect(recordedInputs).toHaveLength(5);
    expect(recordedInputs.map(({ eventSequence }) => eventSequence)).toEqual([1n, 2n, 3n, 4n, 5n]);
    expect(recordedInputs.map(({ evidenceType }) => evidenceType)).toEqual([
      EvidenceType.SPOOF_DEEP,
      EvidenceType.IDENTITY,
      EvidenceType.SPOOF_FAST,
      EvidenceType.INSUFFICIENT_EVIDENCE,
      EvidenceType.PIPELINE_ERROR,
    ]);
    expect(recordedInputs.every(({ reasonCodes }) => reasonCodes?.includes('PROVIDER_STUB'))).toBe(
      true,
    );
  });

  it('replays identical evidence idempotently and rejects conflicting reuse', async () => {
    const event = evidenceBody(
      '018f0000-0000-7000-8000-000000000011',
      1,
      'DEEP',
      EvidenceType.SPOOF_DEEP,
    );
    await postEvidence(event).then((response) => expect(response.status).toBe(202));
    expect(recordedInputs).toHaveLength(1);

    const conflict = { ...event, rawScore: 0.5 };
    const response = await postEvidence(conflict);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });

  it('rejects unauthenticated callbacks and mismatched media binding', async () => {
    const event = evidenceBody(
      '018f0000-0000-7000-8000-000000000016',
      6,
      'PIPELINE_ERROR',
      EvidenceType.PIPELINE_ERROR,
    );
    const unauthenticated = await postEvidence(event, 'wrong-test-secret');
    expect(unauthenticated.status).toBe(401);

    const conflict = await postEvidence({
      ...event,
      trackBindingId: '018f0000-0000-7000-8000-000000000099',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: 'ANALYSIS_BINDING_CONFLICT' });
  });

  it('retains terminal-session evidence as explicitly stale rather than current', async () => {
    callStatus = CallStatus.ENDED;
    sessionStatus = AnalysisSessionStatus.STOPPED;
    const event = evidenceBody(
      '018f0000-0000-7000-8000-000000000017',
      7,
      'PIPELINE_ERROR',
      EvidenceType.PIPELINE_ERROR,
    );

    const response = await postEvidence(event);

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ acceptanceStatus: EvidenceAcceptanceStatus.STALE });
    expect(recordedInputs.at(-1)?.acceptanceStatus).toBe(EvidenceAcceptanceStatus.STALE);
  });
});
