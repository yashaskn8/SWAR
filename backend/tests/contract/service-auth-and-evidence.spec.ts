import { describe, expect, it, vi } from 'vitest';

import {
  AnalysisSessionStatus,
  CallStatus,
  EvidenceAcceptanceStatus,
  EvidenceMode,
  EvidenceType,
  ScoreDirection,
} from '../../src/generated/prisma/client';
import { ConfigurationService } from '../../src/config/configuration';
import { InternalServiceAuthenticatorService } from '../../src/modules/auth/internal-service-authenticator.service';
import type { CallRepository } from '../../src/modules/calls/call.repository';
import { EvidenceIngestionService } from '../../src/modules/evidence/evidence-ingestion.service';
import { MlEvidenceEventType } from '../../src/modules/evidence/evidence.contracts';
import type { EvidenceRepository } from '../../src/modules/evidence/evidence.repository';
import { setValidTestEnvironment } from '../test-environment';

describe('Phase J service authentication and evidence binding', () => {
  it('separates ML and independent-verifier credentials', () => {
    setValidTestEnvironment();
    const configuration = new ConfigurationService(process.env);
    const authentication = new InternalServiceAuthenticatorService(configuration);
    expect(() =>
      authentication.authenticate(
        `Bearer ${configuration.values.secrets.mlInternalSecret}`,
        'swar-ml',
        'swar-ml',
      ),
    ).not.toThrow();
    expect(() =>
      authentication.authenticate(
        `Bearer ${configuration.values.secrets.mlInternalSecret}`,
        'swar-verifier',
        'swar-verifier',
      ),
    ).toThrow();
    expect(() => authentication.authenticate('Bearer user-jwt', 'swar-ml', 'swar-ml')).toThrow();
  });

  it('rejects call/track conflicts and stores terminal-session evidence as STALE', async () => {
    const findAnalysisGrantContext = vi.fn().mockResolvedValue({
      call: { id: '018f0000-0000-7000-8000-000000000003', status: CallStatus.ENDED },
      session: { status: AnalysisSessionStatus.STOPPED },
      binding: { id: '018f0000-0000-7000-8000-000000000005' },
    });
    const record = vi.fn(
      (_context: unknown, input: { acceptanceStatus: EvidenceAcceptanceStatus }) =>
        Promise.resolve({
          id: '018f0000-0000-7000-8000-000000000099',
          acceptanceStatus: input.acceptanceStatus,
        }),
    );
    const service = new EvidenceIngestionService(
      { findAnalysisGrantContext } as unknown as CallRepository,
      { record } as unknown as EvidenceRepository,
    );
    const event = {
      eventType: MlEvidenceEventType.INSUFFICIENT_EVIDENCE,
      eventId: '018f0000-0000-7000-8000-000000000001',
      schemaVersion: '1.0.0',
      organizationId: '018f0000-0000-7000-8000-000000000002',
      callId: '018f0000-0000-7000-8000-000000000003',
      analysisSessionId: '018f0000-0000-7000-8000-000000000004',
      trackBindingId: '018f0000-0000-7000-8000-000000000005',
      eventSequence: '1',
      windowSequence: '1',
      revision: 0,
      evidenceType: EvidenceType.INSUFFICIENT_EVIDENCE,
      windowStartMs: '0',
      windowEndMs: '4000',
      observedAt: '2030-01-01T00:00:04Z',
      reasonCodes: ['INADEQUATE_SPEECH'],
    };
    await expect(service.ingest(event)).resolves.toMatchObject({
      acceptanceStatus: EvidenceAcceptanceStatus.STALE,
    });
    expect(record).toHaveBeenCalledWith(
      { organizationId: event.organizationId },
      expect.objectContaining({ acceptanceStatus: EvidenceAcceptanceStatus.STALE }),
    );
    await expect(
      service.ingest({ ...event, callId: '018f0000-0000-7000-8000-000000000088' }),
    ).rejects.toMatchObject({ code: 'ANALYSIS_BINDING_CONFLICT' });
  });

  it('rejects unsupported schemas and ready evidence without measured latency', async () => {
    const service = new EvidenceIngestionService(
      { findAnalysisGrantContext: vi.fn() } as unknown as CallRepository,
      { record: vi.fn() } as unknown as EvidenceRepository,
    );
    const ready = {
      eventType: MlEvidenceEventType.FAST,
      eventId: '018f0000-0000-7000-8000-000000000001',
      schemaVersion: '1.0.0' as const,
      organizationId: '018f0000-0000-7000-8000-000000000002',
      callId: '018f0000-0000-7000-8000-000000000003',
      analysisSessionId: '018f0000-0000-7000-8000-000000000004',
      trackBindingId: '018f0000-0000-7000-8000-000000000005',
      eventSequence: '1',
      windowSequence: '1',
      revision: 0,
      evidenceType: EvidenceType.IDENTITY,
      windowStartMs: '0',
      windowEndMs: '4000',
      observedAt: '2030-01-01T00:00:04Z',
      modelName: 'FICTIONAL_MODEL',
      modelVersion: 'fictional-v0',
      checkpointHashSha256: 'a'.repeat(64),
      scoreName: 'fictional_raw_score',
      scoreDirection: ScoreDirection.HIGHER_MEANS_MORE,
      rawScore: 0,
    };
    await expect(service.ingest(ready)).rejects.toMatchObject({
      code: 'EVIDENCE_CONTRACT_INVALID',
    });
    await expect(service.ingest({ ...ready, schemaVersion: '2.0.0' })).rejects.toMatchObject({
      code: 'EVIDENCE_CONTRACT_INVALID',
    });
  });

  it('rejects evidence-mode substitution against the authoritative session', async () => {
    const findAnalysisGrantContext = vi.fn().mockResolvedValue({
      call: {
        id: '018f0000-0000-7000-8000-000000000003',
        status: CallStatus.ACTIVE,
      },
      session: {
        status: AnalysisSessionStatus.ACTIVE,
        evidenceMode: EvidenceMode.SHADOW,
      },
      binding: { id: '018f0000-0000-7000-8000-000000000005' },
    });
    const service = new EvidenceIngestionService(
      { findAnalysisGrantContext } as unknown as CallRepository,
      { record: vi.fn() } as unknown as EvidenceRepository,
    );
    await expect(
      service.ingest({
        eventType: MlEvidenceEventType.PIPELINE_ERROR,
        eventId: '018f0000-0000-7000-8000-000000000001',
        schemaVersion: '1.1.0',
        evidenceMode: EvidenceMode.CALIBRATED,
        organizationId: '018f0000-0000-7000-8000-000000000002',
        callId: '018f0000-0000-7000-8000-000000000003',
        analysisSessionId: '018f0000-0000-7000-8000-000000000004',
        trackBindingId: '018f0000-0000-7000-8000-000000000005',
        eventSequence: '1',
        windowSequence: '1',
        revision: 0,
        evidenceType: EvidenceType.PIPELINE_ERROR,
        windowStartMs: '0',
        windowEndMs: '0',
        observedAt: '2030-01-01T00:00:04Z',
        errorCode: 'FIXTURE_FAILURE',
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_MODE_CONFLICT' });
  });
});
