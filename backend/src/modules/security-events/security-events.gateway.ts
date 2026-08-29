import { createHash } from 'node:crypto';

import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';

import { ConfigurationService } from '../../config/configuration';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { AccessSessionAuthenticator } from '../auth/access-session-authenticator.service';
import { CallQueriesService } from '../calls/call-queries.service';
import { SecurityEventPort, type SecurityEvent } from './security-event.port';

interface ClientState {
  principal: AuthPrincipal;
  callIds: Set<string>;
  inboundCount: number;
  inboundWindowStartedAt: number;
  lastAcknowledgedEventId?: string;
}

interface SubscribeInput {
  callIds?: unknown;
  afterEventId?: unknown;
}

function bearer(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7);
  }
  const protocols = request.headers['sec-websocket-protocol'];
  if (typeof protocols !== 'string') return null;
  const encoded = protocols
    .split(',')
    .map((item) => item.trim())
    .find((item) => item.startsWith('swar.bearer.'));
  return encoded?.slice('swar.bearer.'.length) ?? null;
}

function outbound(event: SecurityEvent) {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    callId: event.callId,
    targetId: event.targetId,
    occurredAt: event.occurredAt.toISOString(),
    metadata: event.metadata,
  };
}

@WebSocketGateway({ path: '/ws/security' })
export class SecurityEventsGateway
  extends SecurityEventPort
  implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>
{
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly replay: SecurityEvent[] = [];
  private readonly fingerprints = new Map<string, string>();

  constructor(
    private readonly authenticator: AccessSessionAuthenticator,
    private readonly calls: CallQueriesService,
    private readonly configuration: ConfigurationService,
  ) {
    super();
  }

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    const token = bearer(request);
    if (token === null) {
      client.close(1008, 'AUTHENTICATION_REQUIRED');
      return;
    }
    try {
      const principal = await this.authenticator.authenticate(token);
      this.clients.set(client, {
        principal,
        callIds: new Set(),
        inboundCount: 0,
        inboundWindowStartedAt: Date.now(),
      });
      client.send(
        JSON.stringify({
          event: 'security.ready',
          data: {
            schemaVersion: '1.0.0',
            replayMaximum: this.configuration.values.api.securityEventReplayMaximum,
          },
        }),
      );
    } catch {
      client.close(1008, 'AUTHENTICATION_FAILED');
    }
  }

  handleDisconnect(client: WebSocket): void {
    this.clients.delete(client);
  }

  @SubscribeMessage('security.subscribe')
  async subscribe(@ConnectedSocket() client: WebSocket, @MessageBody() input: SubscribeInput) {
    const state = this.requireState(client);
    if (!this.consumeInbound(client, state)) return undefined;
    if (
      !Array.isArray(input.callIds) ||
      input.callIds.length === 0 ||
      input.callIds.length > this.configuration.values.api.securitySubscriptionMaximumCalls ||
      input.callIds.some((value) => typeof value !== 'string') ||
      (input.afterEventId !== undefined && typeof input.afterEventId !== 'string')
    ) {
      return this.error('SUBSCRIPTION_INVALID');
    }
    const callIds = [...new Set(input.callIds as string[])];
    try {
      for (const callId of callIds) await this.calls.assertReadable(state.principal, callId);
    } catch {
      return this.error('SUBSCRIPTION_FORBIDDEN');
    }
    state.callIds = new Set(callIds);
    const tenantReplay = this.replay.filter(
      (event) =>
        event.organizationId === state.principal.organizationId && state.callIds.has(event.callId),
    );
    let replayStatus: 'COMPLETE' | 'BOUNDARY_EXCEEDED' = 'COMPLETE';
    let replayEvents: SecurityEvent[] = [];
    if (typeof input.afterEventId === 'string') {
      const index = tenantReplay.findIndex(({ eventId }) => eventId === input.afterEventId);
      if (index < 0 && tenantReplay.length > 0) replayStatus = 'BOUNDARY_EXCEEDED';
      else replayEvents = tenantReplay.slice(index + 1);
    }
    for (const event of replayEvents) this.sendEvent(client, event);
    return {
      event: 'security.subscribed',
      data: {
        callIds,
        replayStatus,
        replayedCount: replayEvents.length,
        oldestAvailableEventId: tenantReplay.at(0)?.eventId ?? null,
        latestAvailableEventId: tenantReplay.at(-1)?.eventId ?? null,
      },
    };
  }

  @SubscribeMessage('security.ack')
  acknowledge(@ConnectedSocket() client: WebSocket, @MessageBody() input: { eventId?: unknown }) {
    const state = this.requireState(client);
    if (!this.consumeInbound(client, state)) return undefined;
    if (typeof input.eventId !== 'string' || !this.fingerprints.has(input.eventId)) {
      return this.error('ACK_INVALID');
    }
    state.lastAcknowledgedEventId = input.eventId;
    return { event: 'security.acknowledged', data: { eventId: input.eventId } };
  }

  publish(event: SecurityEvent): Promise<void> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(outbound(event)))
      .digest('hex');
    const existing = this.fingerprints.get(event.eventId);
    if (existing !== undefined) {
      if (existing !== fingerprint) throw new Error('Security event idempotency conflict.');
      return Promise.resolve();
    }
    this.fingerprints.set(event.eventId, fingerprint);
    this.replay.push(event);
    const maximum = this.configuration.values.api.securityEventReplayMaximum;
    while (this.replay.length > maximum) {
      const removed = this.replay.shift();
      if (removed !== undefined) this.fingerprints.delete(removed.eventId);
    }
    for (const [client, state] of this.clients) {
      if (
        state.principal.organizationId === event.organizationId &&
        state.callIds.has(event.callId)
      ) {
        this.sendEvent(client, event);
      }
    }
    return Promise.resolve();
  }

  private requireState(client: WebSocket): ClientState {
    const state = this.clients.get(client);
    if (state === undefined) {
      client.close(1008, 'AUTHENTICATION_REQUIRED');
      throw new Error('Unauthenticated WebSocket client.');
    }
    return state;
  }

  private consumeInbound(client: WebSocket, state: ClientState): boolean {
    const now = Date.now();
    const windowMs = this.configuration.values.api.rateLimitWindowSeconds * 1_000;
    if (state.inboundWindowStartedAt + windowMs <= now) {
      state.inboundWindowStartedAt = now;
      state.inboundCount = 0;
    }
    state.inboundCount += 1;
    if (state.inboundCount > this.configuration.values.api.securityInboundRateLimitMaximum) {
      client.close(1008, 'INBOUND_RATE_LIMITED');
      return false;
    }
    return true;
  }

  private sendEvent(client: WebSocket, event: SecurityEvent): void {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ event: event.eventType, data: outbound(event) }));
    }
  }

  private error(code: string) {
    return {
      event: 'security.error',
      data: { code, message: 'The WebSocket request was rejected.' },
    };
  }
}
