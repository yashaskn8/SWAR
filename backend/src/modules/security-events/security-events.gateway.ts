import { createHash } from 'node:crypto';

import { Optional } from '@nestjs/common';

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
import { SafeLogger } from '../../common/logging/safe-logger.service';
import { OperationalTelemetryService } from '../../common/logging/operational-telemetry.service';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { AccessSessionAuthenticator } from '../auth/access-session-authenticator.service';
import { CallQueriesService } from '../calls/call-queries.service';
import { isSecurityEventId, SecurityEventPort, type SecurityEvent } from './security-event.port';
import { SecurityEventOutboxRepository } from './security-event-outbox.repository';

interface ClientState {
  accessToken: string;
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

const bearerTokenPattern = /^[A-Za-z0-9._~-]{1,4096}$/u;

function bearer(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  let authorizationToken: string | null = null;
  if (authorization !== undefined) {
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
    authorizationToken = authorization.slice(7);
    if (!bearerTokenPattern.test(authorizationToken)) return null;
  }
  const protocols = request.headers['sec-websocket-protocol'];
  if (protocols !== undefined && typeof protocols !== 'string') return null;
  const protocolTokens =
    protocols
      ?.split(',')
      .map((item) => item.trim())
      .filter((item) => item.startsWith('swar.bearer.'))
      .map((item) => item.slice('swar.bearer.'.length)) ?? [];
  if (
    protocolTokens.length > 1 ||
    protocolTokens.some((token) => !bearerTokenPattern.test(token))
  ) {
    return null;
  }
  const protocolToken = protocolTokens.at(0) ?? null;
  if (authorizationToken !== null && protocolToken !== null) return null;
  return authorizationToken ?? protocolToken;
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
  private pendingConnections = 0;

  constructor(
    private readonly authenticator: AccessSessionAuthenticator,
    private readonly calls: CallQueriesService,
    private readonly configuration: ConfigurationService,
    @Optional() private readonly outbox?: SecurityEventOutboxRepository,
    @Optional() private readonly logger?: SafeLogger,
    @Optional() private readonly telemetry?: OperationalTelemetryService,
  ) {
    super();
  }

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    const token = bearer(request);
    if (token === null) {
      client.close(1008, 'AUTHENTICATION_REQUIRED');
      return;
    }
    if (
      this.clients.size + this.pendingConnections >=
      this.configuration.values.api.securityConnectionMaximum
    ) {
      client.close(1013, 'CAPACITY_EXCEEDED');
      this.telemetry?.increment('swar_backend_websocket_connection_rejected_total', {
        reason: 'CAPACITY',
      });
      return;
    }
    this.pendingConnections += 1;
    let principal: AuthPrincipal;
    try {
      principal = await this.authenticator.authenticate(token);
    } catch {
      client.close(1008, 'AUTHENTICATION_FAILED');
      return;
    } finally {
      this.pendingConnections -= 1;
    }
    const state: ClientState = {
      accessToken: token,
      principal,
      callIds: new Set(),
      inboundCount: 0,
      inboundWindowStartedAt: Date.now(),
    };
    this.clients.set(client, state);
    try {
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
      this.dropClient(client, state, 1011, 'DELIVERY_FAILED', 'READY');
    }
  }

  handleDisconnect(client: WebSocket): void {
    const state = this.clients.get(client);
    if (state !== undefined) state.accessToken = '';
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
      (input.afterEventId !== undefined && !isSecurityEventId(input.afterEventId))
    ) {
      return this.error('SUBSCRIPTION_INVALID');
    }
    const callIds = [...new Set(input.callIds as string[])];
    let principal: AuthPrincipal;
    try {
      principal = await this.reauthenticate(state);
    } catch {
      this.revoke(client, state, 'SUBSCRIBE');
      return this.error('SUBSCRIPTION_FORBIDDEN');
    }
    try {
      for (const callId of callIds) await this.calls.assertReadable(principal, callId);
    } catch {
      return this.error('SUBSCRIPTION_FORBIDDEN');
    }
    state.callIds = new Set(callIds);
    if (this.outbox !== undefined) {
      const replay = await this.outbox.replay(
        { organizationId: state.principal.organizationId },
        callIds,
        typeof input.afterEventId === 'string' ? input.afterEventId : undefined,
        this.configuration.values.api.securityEventReplayMaximum,
      );
      for (const event of replay.events) {
        if (!this.sendEvent(client, event)) return this.error('DELIVERY_FAILED');
      }
      this.logger?.event('log', 'security.websocket.replay', {
        organizationId: state.principal.organizationId,
        event: 'security.websocket.replay',
        outcome: replay.status,
        queueDepth: replay.events.length,
      });
      this.telemetry?.increment('swar_backend_websocket_replay_total', {
        status: replay.status,
      });
      this.telemetry?.gauge('swar_backend_websocket_replay_depth', replay.events.length);
      return {
        event: 'security.subscribed',
        data: {
          callIds,
          replayStatus: replay.status,
          replayedCount: replay.events.length,
          oldestAvailableEventId: replay.oldestAvailableEventId,
          latestAvailableEventId: replay.latestAvailableEventId,
        },
      };
    }
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
    for (const event of replayEvents) {
      if (!this.sendEvent(client, event)) return this.error('DELIVERY_FAILED');
    }
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
  async acknowledge(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() input: { eventId?: unknown },
  ) {
    const state = this.requireState(client);
    if (!this.consumeInbound(client, state)) return undefined;
    try {
      await this.reauthorize(state, [...state.callIds]);
    } catch {
      this.revoke(client, state, 'ACK');
      return this.error('ACK_FORBIDDEN');
    }
    if (!isSecurityEventId(input.eventId)) {
      return this.error('ACK_INVALID');
    }
    if (this.outbox !== undefined) {
      try {
        await this.outbox.acknowledge(
          { organizationId: state.principal.organizationId },
          state.principal.membershipId,
          [...state.callIds],
          input.eventId,
        );
      } catch {
        return this.error('ACK_INVALID');
      }
    } else if (
      !this.replay.some(
        (event) =>
          event.eventId === input.eventId &&
          event.organizationId === state.principal.organizationId &&
          state.callIds.has(event.callId),
      )
    ) {
      return this.error('ACK_INVALID');
    }
    state.lastAcknowledgedEventId = input.eventId;
    this.logger?.event('log', 'security.websocket.acknowledged', {
      organizationId: state.principal.organizationId,
      event: 'security.websocket.acknowledged',
      outcome: 'ACKNOWLEDGED',
    });
    this.telemetry?.increment('swar_backend_websocket_ack_total', { status: 'ACKNOWLEDGED' });
    return { event: 'security.acknowledged', data: { eventId: input.eventId } };
  }

  async publish(event: SecurityEvent): Promise<void> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(outbound(event)))
      .digest('hex');
    const existing = this.fingerprints.get(event.eventId);
    if (existing !== undefined) {
      if (existing !== fingerprint) throw new Error('Security event idempotency conflict.');
      return;
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
        try {
          await this.reauthorize(state, [event.callId]);
        } catch {
          this.revoke(client, state, 'PUBLISH');
          continue;
        }
        this.sendEvent(client, event);
      }
    }
  }

  private async reauthenticate(state: ClientState): Promise<AuthPrincipal> {
    const principal = await this.authenticator.authenticate(state.accessToken);
    if (
      principal.organizationId !== state.principal.organizationId ||
      principal.membershipId !== state.principal.membershipId ||
      principal.userId !== state.principal.userId ||
      principal.deviceId !== state.principal.deviceId ||
      principal.sessionId !== state.principal.sessionId
    ) {
      throw new Error('WebSocket authorization context changed.');
    }
    state.principal = principal;
    return principal;
  }

  private async reauthorize(state: ClientState, callIds: string[]): Promise<void> {
    const principal = await this.reauthenticate(state);
    for (const callId of callIds) await this.calls.assertReadable(principal, callId);
  }

  private revoke(client: WebSocket, state: ClientState, operation: string): void {
    this.dropClient(client, state, 1008, 'AUTHORIZATION_REVOKED', operation);
    this.logger?.event('warn', 'security.websocket.authorization-revoked', {
      organizationId: state.principal.organizationId,
      event: 'security.websocket.authorization-revoked',
      outcome: 'DENIED',
      operation,
    });
    this.telemetry?.increment('swar_backend_websocket_authorization_denied_total', {
      operation,
    });
  }

  private dropClient(
    client: WebSocket,
    state: ClientState,
    code: number,
    reason: string,
    operation: string,
  ): void {
    state.accessToken = '';
    this.clients.delete(client);
    try {
      client.close(code, reason);
    } catch {
      // The socket is already unusable; state and token references are still removed.
    }
    if (reason === 'DELIVERY_FAILED') {
      this.logger?.event('warn', 'security.websocket.delivery-failed', {
        organizationId: state.principal.organizationId,
        event: 'security.websocket.delivery-failed',
        outcome: 'DISCONNECTED',
        operation,
      });
      this.telemetry?.increment('swar_backend_websocket_delivery_total', {
        status: 'FAILED',
      });
    }
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
      this.dropClient(client, state, 1008, 'INBOUND_RATE_LIMITED', 'INBOUND');
      return false;
    }
    return true;
  }

  private sendEvent(client: WebSocket, event: SecurityEvent): boolean {
    if (client.readyState !== 1) {
      const state = this.clients.get(client);
      if (state !== undefined) this.dropClient(client, state, 1011, 'DELIVERY_FAILED', 'PUBLISH');
      return false;
    }
    try {
      client.send(JSON.stringify({ event: event.eventType, data: outbound(event) }));
      return true;
    } catch {
      const state = this.clients.get(client);
      if (state !== undefined) this.dropClient(client, state, 1011, 'DELIVERY_FAILED', 'PUBLISH');
      return false;
    }
  }

  private error(code: string) {
    return {
      event: 'security.error',
      data: { code, message: 'The WebSocket request was rejected.' },
    };
  }
}
