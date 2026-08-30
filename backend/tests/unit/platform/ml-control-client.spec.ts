import { createHash, createHmac } from 'node:crypto';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { ConfigurationService } from '../../../src/config/configuration';
import { EvidenceMode } from '../../../src/generated/prisma/client';
import { MlControlClient } from '../../../src/integrations/ml/ml-control.client';
import type { MlAnalysisGrant } from '../../../src/integrations/ml/ml-control.port';
import { validTestEnvironment } from '../../test-environment';

const grant: MlAnalysisGrant = {
  organizationId: '018f0000-0000-7000-8000-000000000001',
  sessionId: '018f0000-0000-7000-8000-000000000002',
  callId: '018f0000-0000-7000-8000-000000000003',
  roomName: 'swar-test-room',
  participantIdentity: 'caller:server-authorized',
  trackSid: 'TR_server_authorized',
  bindingId: '018f0000-0000-7000-8000-000000000004',
  bindingRevision: 2,
  evidenceMode: EvidenceMode.SHADOW,
  grantToken: 'short-lived-livekit-grant',
  grantExpiresAt: new Date(Date.now() + 60_000),
  expiresAt: new Date(Date.now() + 120_000),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Phase P authenticated ML control client', () => {
  test('signs the exact request and retries a transient model-service outage', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const configuration = new ConfigurationService(validTestEnvironment());
    const client = new MlControlClient(configuration);

    await expect(client.startAnalysis(grant)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe('http://127.0.0.1:8000/internal/v1/analysis-sessions');
    const headers = init?.headers as Record<string, string>;
    expect(typeof init?.body).toBe('string');
    const body = init?.body as string;
    expect(headers.Authorization).toBe(`Bearer ${configuration.values.secrets.mlInternalSecret}`);
    expect(headers['X-SWAR-Service']).toBe('swar-backend');
    expect(headers['Idempotency-Key']).toBe(`analysis-start:${grant.sessionId}`);
    expect(headers['X-SWAR-Nonce']).not.toBe(
      (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)['X-SWAR-Nonce'],
    );
    const canonical = [
      'POST',
      '/internal/v1/analysis-sessions',
      headers['X-SWAR-Timestamp'],
      headers['X-SWAR-Nonce'],
      headers['Idempotency-Key'],
      createHash('sha256').update(body).digest('hex'),
    ].join('\n');
    expect(headers['X-SWAR-Signature']).toBe(
      createHmac('sha256', configuration.values.secrets.mlInternalSecret)
        .update(canonical)
        .digest('hex'),
    );
    expect(JSON.parse(body)).toMatchObject({
      schemaVersion: '2.0.0',
      organizationId: grant.organizationId,
      analysisSessionId: grant.sessionId,
      callId: grant.callId,
      roomName: grant.roomName,
      participantIdentity: grant.participantIdentity,
      trackSid: grant.trackSid,
      bindingRevision: grant.bindingRevision,
      evidenceMode: EvidenceMode.SHADOW,
    });
  });

  test('does not retry a deterministic binding rejection', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 'ANALYSIS_BINDING_CONFLICT' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new MlControlClient(
      new ConfigurationService(validTestEnvironment({ ML_CONTROL_MAX_ATTEMPTS: '3' })),
    );

    await expect(client.startAnalysis(grant)).rejects.toMatchObject({
      code: 'ML_CONTROL_REJECTED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('bounds retries and exposes only a stable outage code', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('private upstream text'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new MlControlClient(
      new ConfigurationService(validTestEnvironment({ ML_CONTROL_MAX_ATTEMPTS: '2' })),
    );

    await expect(client.startAnalysis(grant)).rejects.toMatchObject({
      code: 'ML_CONTROL_UNAVAILABLE',
      message: 'ML_CONTROL_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
