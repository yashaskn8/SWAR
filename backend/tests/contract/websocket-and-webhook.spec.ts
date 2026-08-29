import type { IncomingMessage } from 'node:http';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';

import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { ConfigurationService } from '../../src/config/configuration';
import type { LiveKitPort } from '../../src/integrations/livekit/livekit.port';
import type { AccessSessionAuthenticator } from '../../src/modules/auth/access-session-authenticator.service';
import type { AuthPrincipal } from '../../src/modules/auth/refresh-session.repository';
import type { CallQueriesService } from '../../src/modules/calls/call-queries.service';
import { LiveKitWebhookController } from '../../src/modules/media/livekit-webhook.controller';
import type { TrackBindingService } from '../../src/modules/media/track-binding.service';
import { SecurityEventsGateway } from '../../src/modules/security-events/security-events.gateway';
import { setValidTestEnvironment } from '../test-environment';

interface FakeSocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function client(): FakeSocket {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  };
}

const socket = (value: FakeSocket): WebSocket => value as unknown as WebSocket;

function principal(organizationId: string): AuthPrincipal {
  return {
    organizationId,
    userId: '018f0000-0000-7000-8000-000000000010',
    membershipId: '018f0000-0000-7000-8000-000000000011',
    deviceId: '018f0000-0000-7000-8000-000000000012',
    sessionId: '018f0000-0000-7000-8000-000000000013',
    roles: ['SECURITY_ANALYST'],
  };
}

describe('Phase J WebSocket and webhook adapters', () => {
  it('authenticates WebSockets, scopes subscriptions, deduplicates, and reports replay boundaries', async () => {
    setValidTestEnvironment();
    const configuration = new ConfigurationService(process.env);
    const authenticate = vi.fn((token: string) =>
      Promise.resolve(
        principal(
          token === 'tenant-a-token'
            ? '018f0000-0000-7000-8000-000000000021'
            : '018f0000-0000-7000-8000-000000000022',
        ),
      ),
    );
    const assertReadable = vi.fn().mockResolvedValue(undefined);
    const gateway = new SecurityEventsGateway(
      { authenticate } as unknown as AccessSessionAuthenticator,
      { assertReadable } as unknown as CallQueriesService,
      configuration,
    );
    const unauthenticated = client();
    await gateway.handleConnection(socket(unauthenticated), { headers: {} } as IncomingMessage);
    expect(unauthenticated.close).toHaveBeenCalledWith(1008, 'AUTHENTICATION_REQUIRED');

    const tenantA = client();
    const tenantB = client();
    await gateway.handleConnection(socket(tenantA), {
      headers: { 'sec-websocket-protocol': 'swar.security.v1, swar.bearer.tenant-a-token' },
    } as IncomingMessage);
    await gateway.handleConnection(socket(tenantB), {
      headers: { authorization: 'Bearer tenant-b-token' },
    } as IncomingMessage);
    tenantA.send.mockClear();
    tenantB.send.mockClear();
    const callId = '018f0000-0000-7000-8000-000000000030';
    await expect(gateway.subscribe(socket(tenantA), { callIds: [callId] })).resolves.toMatchObject({
      event: 'security.subscribed',
      data: { replayStatus: 'COMPLETE' },
    });
    await gateway.publish({
      eventId: `evt_${'a'.repeat(64)}`,
      eventType: 'risk.state.changed',
      schemaVersion: '1.0.0',
      organizationId: '018f0000-0000-7000-8000-000000000021',
      callId,
      targetId: '018f0000-0000-7000-8000-000000000031',
      occurredAt: new Date('2030-01-01T00:00:00Z'),
      metadata: { state: 'CRITICAL', policyVersion: 'fictional-v1' },
    });
    expect(tenantA.send).toHaveBeenCalledTimes(1);
    expect(tenantB.send).not.toHaveBeenCalled();
    await gateway.publish({
      eventId: `evt_${'a'.repeat(64)}`,
      eventType: 'risk.state.changed',
      schemaVersion: '1.0.0',
      organizationId: '018f0000-0000-7000-8000-000000000021',
      callId,
      targetId: '018f0000-0000-7000-8000-000000000031',
      occurredAt: new Date('2030-01-01T00:00:00Z'),
      metadata: { state: 'CRITICAL', policyVersion: 'fictional-v1' },
    });
    expect(tenantA.send).toHaveBeenCalledTimes(1);
    const resumed = client();
    await gateway.handleConnection(socket(resumed), {
      headers: { authorization: 'Bearer tenant-a-token' },
    } as IncomingMessage);
    const result = await gateway.subscribe(socket(resumed), {
      callIds: [callId],
      afterEventId: `evt_${'b'.repeat(64)}`,
    });
    expect(result).toMatchObject({ data: { replayStatus: 'BOUNDARY_EXCEEDED' } });
  });

  it('verifies each webhook body before idempotent track binding', async () => {
    setValidTestEnvironment();
    const configuration = new ConfigurationService(process.env);
    const verifyWebhook = vi.fn().mockResolvedValue({
      verification: 'LIVEKIT_SIGNATURE_VERIFIED',
      eventId: 'fictional-livekit-event',
      eventType: 'participant_joined',
      roomName: 'fictional-room',
      participantIdentity: 'fictional-participant',
      occurredAt: new Date('2030-01-01T00:00:00Z'),
    });
    const handleVerifiedLifecycle = vi.fn().mockResolvedValue(null);
    const controller = new LiveKitWebhookController(
      { verifyWebhook } as unknown as LiveKitPort,
      { handleVerifiedLifecycle } as unknown as TrackBindingService,
      new IdempotencyService(configuration),
    );
    const request = { rawBody: Buffer.from('{"fictional":true}') } as RawBodyRequest<Request>;
    await controller.receive(request, 'signed-webhook');
    await controller.receive(request, 'signed-webhook');
    expect(verifyWebhook).toHaveBeenCalledTimes(2);
    expect(handleVerifiedLifecycle).toHaveBeenCalledTimes(1);
    await expect(
      controller.receive(
        { rawBody: Buffer.from('{"fictional":false}') } as RawBodyRequest<Request>,
        'signed-webhook',
      ),
    ).rejects.toBeDefined();
    expect(handleVerifiedLifecycle).toHaveBeenCalledTimes(1);
  });
});
