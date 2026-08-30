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
import type { SecurityEventOutboxRepository } from '../../src/modules/security-events/security-event-outbox.repository';
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
  it('rejects ambiguous WebSocket credentials and enforces the authenticated connection bound', async () => {
    setValidTestEnvironment({ SECURITY_WS_CONNECTION_MAXIMUM: '1' });
    const authenticate = vi
      .fn()
      .mockResolvedValue(principal('018f0000-0000-7000-8000-000000000021'));
    const gateway = new SecurityEventsGateway(
      { authenticate } as unknown as AccessSessionAuthenticator,
      { assertReadable: vi.fn() } as unknown as CallQueriesService,
      new ConfigurationService(process.env),
    );
    const ambiguous = client();
    await gateway.handleConnection(socket(ambiguous), {
      headers: {
        authorization: 'Bearer header-token',
        'sec-websocket-protocol': 'swar.security.v1, swar.bearer.protocol-token',
      },
    } as IncomingMessage);
    expect(ambiguous.close).toHaveBeenCalledWith(1008, 'AUTHENTICATION_REQUIRED');
    expect(authenticate).not.toHaveBeenCalled();

    const accepted = client();
    await gateway.handleConnection(socket(accepted), {
      headers: { authorization: 'Bearer tenant-a-token' },
    } as IncomingMessage);
    const excess = client();
    await gateway.handleConnection(socket(excess), {
      headers: { authorization: 'Bearer tenant-a-token' },
    } as IncomingMessage);
    expect(excess.close).toHaveBeenCalledWith(1013, 'CAPACITY_EXCEEDED');
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

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
    const forbiddenCallId = '018f0000-0000-7000-8000-000000000099';
    assertReadable.mockRejectedValueOnce(new Error('cross-tenant call'));
    await expect(
      gateway.subscribe(socket(tenantA), { callIds: [forbiddenCallId] }),
    ).resolves.toMatchObject({
      event: 'security.error',
      data: { code: 'SUBSCRIPTION_FORBIDDEN' },
    });
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

  it('uses tenant-scoped durable replay and rejects acknowledgements outside the subscription', async () => {
    setValidTestEnvironment();
    const organizationId = '018f0000-0000-7000-8000-000000000021';
    const callId = '018f0000-0000-7000-8000-000000000030';
    const eventId = `evt_${'c'.repeat(64)}`;
    const authenticate = vi.fn().mockResolvedValue(principal(organizationId));
    const assertReadable = vi.fn().mockResolvedValue(undefined);
    const replay = vi.fn().mockResolvedValue({
      status: 'COMPLETE',
      events: [],
      oldestAvailableEventId: eventId,
      latestAvailableEventId: eventId,
    });
    const acknowledge = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('cross-tenant or unsubscribed event'));
    const gateway = new SecurityEventsGateway(
      { authenticate } as unknown as AccessSessionAuthenticator,
      { assertReadable } as unknown as CallQueriesService,
      new ConfigurationService(process.env),
      { replay, acknowledge } as unknown as SecurityEventOutboxRepository,
    );
    const tenant = client();
    await gateway.handleConnection(socket(tenant), {
      headers: { authorization: 'Bearer tenant-a-token' },
    } as IncomingMessage);
    await expect(
      gateway.subscribe(socket(tenant), { callIds: [callId], afterEventId: eventId }),
    ).resolves.toMatchObject({
      event: 'security.subscribed',
      data: { replayStatus: 'COMPLETE', oldestAvailableEventId: eventId },
    });
    expect(replay).toHaveBeenCalledWith({ organizationId }, [callId], eventId, expect.any(Number));
    await expect(gateway.acknowledge(socket(tenant), { eventId })).resolves.toMatchObject({
      event: 'security.acknowledged',
    });
    await expect(
      gateway.acknowledge(socket(tenant), { eventId: `evt_${'d'.repeat(64)}` }),
    ).resolves.toMatchObject({ event: 'security.error', data: { code: 'ACK_INVALID' } });
    await expect(
      gateway.subscribe(socket(tenant), { callIds: [callId], afterEventId: 'invalid-cursor' }),
    ).resolves.toMatchObject({ event: 'security.error', data: { code: 'SUBSCRIPTION_INVALID' } });
    await expect(
      gateway.acknowledge(socket(tenant), { eventId: 'invalid-event-id' }),
    ).resolves.toMatchObject({ event: 'security.error', data: { code: 'ACK_INVALID' } });
  });

  it('reauthorizes active subscriptions before publication and acknowledgement', async () => {
    setValidTestEnvironment();
    const organizationId = '018f0000-0000-7000-8000-000000000021';
    const callId = '018f0000-0000-7000-8000-000000000030';
    const eventId = `evt_${'e'.repeat(64)}`;
    let revoked = false;
    const authenticate = vi.fn(() =>
      revoked
        ? Promise.reject(new Error('membership revoked'))
        : Promise.resolve(principal(organizationId)),
    );
    const assertReadable = vi.fn().mockResolvedValue(undefined);
    const configuration = new ConfigurationService(process.env);
    const gateway = new SecurityEventsGateway(
      { authenticate } as unknown as AccessSessionAuthenticator,
      { assertReadable } as unknown as CallQueriesService,
      configuration,
    );
    const publishingClient = client();
    await gateway.handleConnection(socket(publishingClient), {
      headers: { authorization: 'Bearer tenant-a-token' },
    } as IncomingMessage);
    await gateway.subscribe(socket(publishingClient), { callIds: [callId] });
    publishingClient.send.mockClear();
    revoked = true;
    await gateway.publish({
      eventId,
      eventType: 'risk.state.changed',
      schemaVersion: '1.1.0',
      organizationId,
      callId,
      targetId: '018f0000-0000-7000-8000-000000000031',
      occurredAt: new Date('2030-01-01T00:00:00Z'),
      metadata: { mode: 'SHADOW', state: 'UNVERIFIED' },
    });
    expect(publishingClient.send).not.toHaveBeenCalled();
    expect(publishingClient.close).toHaveBeenCalledWith(1008, 'AUTHORIZATION_REVOKED');

    revoked = false;
    const acknowledgingClient = client();
    await gateway.handleConnection(socket(acknowledgingClient), {
      headers: { authorization: 'Bearer tenant-a-token' },
    } as IncomingMessage);
    await gateway.subscribe(socket(acknowledgingClient), { callIds: [callId] });
    revoked = true;
    await expect(
      gateway.acknowledge(socket(acknowledgingClient), { eventId }),
    ).resolves.toMatchObject({ event: 'security.error', data: { code: 'ACK_FORBIDDEN' } });
    expect(acknowledgingClient.close).toHaveBeenCalledWith(1008, 'AUTHORIZATION_REVOKED');
  });

  it('isolates a failed WebSocket send without blocking other authorized subscribers', async () => {
    setValidTestEnvironment();
    const organizationId = '018f0000-0000-7000-8000-000000000021';
    const callId = '018f0000-0000-7000-8000-000000000030';
    const authenticate = vi.fn().mockResolvedValue(principal(organizationId));
    const gateway = new SecurityEventsGateway(
      { authenticate } as unknown as AccessSessionAuthenticator,
      { assertReadable: vi.fn().mockResolvedValue(undefined) } as unknown as CallQueriesService,
      new ConfigurationService(process.env),
    );
    const broken = client();
    const healthy = client();
    for (const connected of [broken, healthy]) {
      await gateway.handleConnection(socket(connected), {
        headers: { authorization: 'Bearer tenant-a-token' },
      } as IncomingMessage);
      await gateway.subscribe(socket(connected), { callIds: [callId] });
      connected.send.mockClear();
    }
    broken.send.mockImplementationOnce(() => {
      throw new Error('socket write failed');
    });
    await expect(
      gateway.publish({
        eventId: `evt_${'f'.repeat(64)}`,
        eventType: 'dashboard.risk-event.created',
        schemaVersion: '1.1.0',
        organizationId,
        callId,
        targetId: '018f0000-0000-7000-8000-000000000031',
        occurredAt: new Date('2030-01-01T00:00:00Z'),
        metadata: { mode: 'SHADOW', state: 'UNVERIFIED' },
      }),
    ).resolves.toBeUndefined();
    expect(broken.close).toHaveBeenCalledWith(1011, 'DELIVERY_FAILED');
    expect(healthy.send).toHaveBeenCalledTimes(1);
  });
});
