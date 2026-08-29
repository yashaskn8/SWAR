import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AuditOutcome,
  CallStatus,
  ParticipantRole,
  type Call,
  type CallParticipant,
} from '../../generated/prisma/client';
import {
  LiveKitPort,
  type LiveKitParticipantGrant,
  type LiveKitParticipantProfile,
} from '../../integrations/livekit/livekit.port';
import { MlControlPort } from '../../integrations/ml/ml-control.port';
import { ConfigurationService } from '../../config/configuration';
import { PersistenceConflictError } from '../../database/database.errors';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { AuditService } from '../audit/audit.service';
import { DomainProviderError } from '../domain/domain.errors';
import { assertTransition, callTransitions } from '../domain/domain-state-machines';
import { CallRepository, type CallParticipantInput } from './call.repository';

function stableIdentity(parts: readonly string[]): string {
  return `swar-${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 40)}`;
}

function profile(role: ParticipantRole): LiveKitParticipantProfile {
  return role;
}

export interface CreateCallCommand {
  riskPolicyId: string;
  riskPolicyVersion: string;
  expectedTrustedSpeakerId?: string;
  protectedActionReference?: string;
  idempotencyKey: string;
  maximumParticipants: number;
  correlationId: string;
}

export interface InviteParticipantCommand {
  callId: string;
  role: Exclude<ParticipantRole, 'ML_SUBSCRIBER'>;
  membershipId?: string;
  trustedSpeakerId?: string;
  displayName?: string;
  idempotencyKey: string;
  correlationId: string;
}

@Injectable()
export class CallsService {
  constructor(
    private readonly calls: CallRepository,
    private readonly authorization: ResourceAuthorizationService,
    @Inject(LiveKitPort) private readonly liveKit: LiveKitPort,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    @Optional() @Inject(MlControlPort) private readonly ml?: MlControlPort,
  ) {}

  async create(principal: AuthPrincipal, command: CreateCallCommand): Promise<Call> {
    this.authorization.assert(principal, 'call.create', principal.organizationId);
    if (
      !Number.isInteger(command.maximumParticipants) ||
      command.maximumParticipants < 2 ||
      command.maximumParticipants > 20
    ) {
      throw new PersistenceConflictError('Call participant limit is invalid.');
    }
    const roomName = stableIdentity([principal.organizationId, command.idempotencyKey, 'room']);
    const customerIdentity = stableIdentity([
      principal.organizationId,
      command.idempotencyKey,
      principal.membershipId,
      ParticipantRole.CUSTOMER,
    ]);
    const call = await this.calls.createCallWithParticipants(
      { organizationId: principal.organizationId },
      {
        roomName,
        ...(command.expectedTrustedSpeakerId === undefined
          ? {}
          : { expectedTrustedSpeakerId: command.expectedTrustedSpeakerId }),
        riskPolicyId: command.riskPolicyId,
        riskPolicyVersion: command.riskPolicyVersion,
        createdByMembershipId: principal.membershipId,
        idempotencyKey: command.idempotencyKey,
        ...(command.protectedActionReference === undefined
          ? {}
          : { protectedActionReference: command.protectedActionReference }),
        participants: [
          {
            membershipId: principal.membershipId,
            livekitIdentity: customerIdentity,
            authorizedIdentity: `membership:${principal.membershipId}`,
            role: ParticipantRole.CUSTOMER,
          },
        ],
      },
    );
    try {
      await this.liveKit.createRoom({
        roomName: call.roomName,
        callId: call.id,
        maxParticipants: command.maximumParticipants,
      });
    } catch {
      if (call.status === CallStatus.AUTHORIZED) {
        assertTransition('Call', callTransitions, call.status, CallStatus.FAILED);
        await this.calls.transitionCall(
          { organizationId: principal.organizationId },
          {
            callId: call.id,
            expected: CallStatus.AUTHORIZED,
            next: CallStatus.FAILED,
            occurredAt: new Date(),
          },
        );
      }
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: command.correlationId,
        idempotencyKey: `${command.idempotencyKey}:room-failed`,
        action: 'call.room.create.failed',
        targetType: 'Call',
        targetId: call.id,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'LIVEKIT_ROOM_CREATE_FAILED',
        operation: 'call-create',
      });
      throw new DomainProviderError('LIVEKIT', 'room-create', CallStatus.FAILED);
    }
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: command.correlationId,
      idempotencyKey: `${command.idempotencyKey}:created`,
      action: 'call.created',
      targetType: 'Call',
      targetId: call.id,
      operation: 'call-create',
    });
    return call;
  }

  async invite(
    principal: AuthPrincipal,
    command: InviteParticipantCommand,
  ): Promise<{ participant: CallParticipant; grant: LiveKitParticipantGrant }> {
    this.authorization.assert(principal, 'call.create', principal.organizationId);
    if (
      (command.role === ParticipantRole.CUSTOMER || command.role === ParticipantRole.OBSERVER) &&
      command.membershipId === undefined
    ) {
      throw new PersistenceConflictError('Customer and observer participants require membership.');
    }
    if (
      command.role === ParticipantRole.CALLER &&
      command.membershipId === undefined &&
      command.trustedSpeakerId === undefined
    ) {
      throw new PersistenceConflictError(
        'Caller participants require membership or a trusted-speaker authorization.',
      );
    }
    const context = { organizationId: principal.organizationId };
    const call = await this.calls.findTenantCall(context, command.callId);
    const livekitIdentity = stableIdentity([
      principal.organizationId,
      call.id,
      command.idempotencyKey,
      command.role,
    ]);
    const participantInput: CallParticipantInput = {
      ...(command.membershipId === undefined ? {} : { membershipId: command.membershipId }),
      ...(command.trustedSpeakerId === undefined
        ? {}
        : { trustedSpeakerId: command.trustedSpeakerId }),
      livekitIdentity,
      authorizedIdentity:
        command.membershipId === undefined
          ? `trusted-speaker:${command.trustedSpeakerId ?? 'unassigned'}`
          : `membership:${command.membershipId}`,
      ...(command.displayName === undefined ? {} : { displayName: command.displayName }),
      role: command.role,
    };
    const participant = await this.calls.addParticipant(context, {
      callId: call.id,
      participant: participantInput,
    });
    try {
      const grant = await this.liveKit.issueParticipantGrant({
        roomName: call.roomName,
        participantIdentity: participant.livekitIdentity,
        profile: profile(participant.role),
        ttlSeconds: this.configuration.values.dependencies.liveKitParticipantGrantTtlSeconds,
      });
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: command.correlationId,
        idempotencyKey: `${command.idempotencyKey}:invited`,
        action: 'call.participant.invited',
        targetType: 'CallParticipant',
        targetId: participant.id,
        operation: 'participant-invite',
      });
      return { participant, grant };
    } catch {
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: command.correlationId,
        idempotencyKey: `${command.idempotencyKey}:grant-failed`,
        action: 'call.participant.grant.failed',
        targetType: 'CallParticipant',
        targetId: participant.id,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'LIVEKIT_GRANT_FAILED',
        operation: 'participant-invite',
      });
      throw new DomainProviderError('LIVEKIT', 'participant-grant', participant.status);
    }
  }

  async answer(
    principal: AuthPrincipal,
    input: { callId: string; participantId: string; correlationId: string },
  ): Promise<LiveKitParticipantGrant> {
    this.authorization.assert(principal, 'call.read', principal.organizationId);
    const aggregate = await this.calls.findCallAggregate(
      { organizationId: principal.organizationId },
      input.callId,
    );
    const participant = aggregate.participants.find(({ id }) => id === input.participantId);
    if (participant?.membershipId !== principal.membershipId) {
      throw new PersistenceConflictError('Only the authorized participant may answer this call.');
    }
    const grant = await this.liveKit.issueParticipantGrant({
      roomName: aggregate.call.roomName,
      participantIdentity: participant.livekitIdentity,
      profile: profile(participant.role),
      ttlSeconds: this.configuration.values.dependencies.liveKitParticipantGrantTtlSeconds,
    });
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: input.correlationId,
      action: 'call.participant.answer.authorized',
      targetType: 'CallParticipant',
      targetId: participant.id,
      operation: 'call-answer',
    });
    return grant;
  }

  async end(
    principal: AuthPrincipal,
    input: { callId: string; idempotencyKey: string; correlationId: string },
  ): Promise<Call> {
    this.authorization.assert(principal, 'call.end', principal.organizationId);
    const context = { organizationId: principal.organizationId };
    const aggregate = await this.calls.findCallAggregate(context, input.callId);
    const now = new Date();
    if (
      aggregate.call.status === CallStatus.ENDED ||
      aggregate.call.status === CallStatus.CANCELLED
    ) {
      return aggregate.call;
    }
    if (aggregate.call.status === CallStatus.AUTHORIZED) {
      try {
        await this.liveKit.closeRoom(aggregate.call.roomName);
      } catch {
        await this.audit.record({
          organizationId: principal.organizationId,
          actor: principal,
          correlationId: input.correlationId,
          idempotencyKey: `${input.idempotencyKey}:cancel-failed`,
          action: 'call.cancel.provider-unknown',
          targetType: 'Call',
          targetId: aggregate.call.id,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'LIVEKIT_ROOM_CLOSE_FAILED_OR_TIMED_OUT',
          operation: 'call-cancel',
        });
        throw new DomainProviderError('LIVEKIT', 'call-cancel', CallStatus.AUTHORIZED);
      }
      assertTransition('Call', callTransitions, CallStatus.AUTHORIZED, CallStatus.CANCELLED);
      const cancelled = await this.calls.transitionCall(context, {
        callId: aggregate.call.id,
        expected: CallStatus.AUTHORIZED,
        next: CallStatus.CANCELLED,
        occurredAt: now,
      });
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:cancelled`,
        action: 'call.cancelled',
        targetType: 'Call',
        targetId: cancelled.id,
        operation: 'call-cancel',
      });
      return cancelled;
    }
    if (
      aggregate.call.status !== CallStatus.ACTIVE &&
      aggregate.call.status !== CallStatus.ENDING
    ) {
      throw new PersistenceConflictError('Call cannot be ended from its current state.');
    }
    if (aggregate.call.status === CallStatus.ACTIVE) {
      assertTransition('Call', callTransitions, CallStatus.ACTIVE, CallStatus.ENDING);
      await this.calls.transitionCall(context, {
        callId: aggregate.call.id,
        expected: CallStatus.ACTIVE,
        next: CallStatus.ENDING,
        occurredAt: now,
      });
    }
    try {
      const sessions = await this.calls.listOpenAnalysisSessions(context, aggregate.call.id);
      if (sessions.length > 0 && this.ml === undefined) {
        throw new Error('ML control provider unavailable');
      }
      for (const session of sessions) {
        await this.ml!.stopAnalysis({ sessionId: session.id, reasonCode: 'CALL_ENDED' });
      }
      for (const participant of aggregate.participants) {
        await this.liveKit.removeParticipant(aggregate.call.roomName, participant.livekitIdentity);
      }
      await this.liveKit.closeRoom(aggregate.call.roomName);
      assertTransition('Call', callTransitions, CallStatus.ENDING, CallStatus.ENDED);
      const ended = await this.calls.transitionCall(context, {
        callId: aggregate.call.id,
        expected: CallStatus.ENDING,
        next: CallStatus.ENDED,
        occurredAt: new Date(),
      });
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:ended`,
        action: 'call.ended',
        targetType: 'Call',
        targetId: ended.id,
        operation: 'call-end',
      });
      return ended;
    } catch {
      assertTransition('Call', callTransitions, CallStatus.ENDING, CallStatus.FAILED);
      await this.calls.transitionCall(context, {
        callId: aggregate.call.id,
        expected: CallStatus.ENDING,
        next: CallStatus.FAILED,
        occurredAt: new Date(),
      });
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:cleanup-failed`,
        action: 'call.cleanup.failed',
        targetType: 'Call',
        targetId: aggregate.call.id,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'PROVIDER_CLEANUP_FAILED',
        operation: 'call-end',
      });
      throw new DomainProviderError('LIVEKIT', 'call-cleanup', CallStatus.FAILED);
    }
  }
}
