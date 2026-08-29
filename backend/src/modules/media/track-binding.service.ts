import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AuditOutcome,
  CallStatus,
  ParticipantRole,
  type AnalysisSession,
} from '../../generated/prisma/client';
import type { VerifiedLiveKitLifecycleEvent } from '../../integrations/livekit/livekit.port';
import { MlControlPort } from '../../integrations/ml/ml-control.port';
import { ConfigurationService } from '../../config/configuration';
import { PersistenceConflictError } from '../../database/database.errors';
import { AnalysisService } from '../analysis/analysis.service';
import { AuditService } from '../audit/audit.service';
import { CallRepository } from '../calls/call.repository';
import { assertTransition, callTransitions } from '../domain/domain-state-machines';
import { EnrollmentRepository } from '../enrollment/enrollment.repository';

@Injectable()
export class TrackBindingService {
  constructor(
    private readonly calls: CallRepository,
    private readonly enrollment: EnrollmentRepository,
    private readonly analysis: AnalysisService,
    private readonly configuration: ConfigurationService,
    private readonly audit: AuditService,
    @Optional() @Inject(MlControlPort) private readonly ml?: MlControlPort,
  ) {}

  async handleVerifiedLifecycle(
    event: VerifiedLiveKitLifecycleEvent,
  ): Promise<AnalysisSession | null> {
    if (event.verification !== 'LIVEKIT_SIGNATURE_VERIFIED') {
      throw new PersistenceConflictError('LiveKit lifecycle input was not signature verified.');
    }
    if (event.eventType === 'room_finished') return null;
    if (event.participantIdentity === undefined) {
      throw new PersistenceConflictError('Verified participant identity is required.');
    }
    const resolved = await this.calls.findByVerifiedRoomParticipant(
      event.roomName,
      event.participantIdentity,
    );
    const context = { organizationId: resolved.call.organizationId };
    if (event.eventType === 'participant_joined') {
      await this.calls.markParticipantJoined(context, resolved.participant.id, event.occurredAt);
      if (resolved.call.status === CallStatus.AUTHORIZED) {
        assertTransition('Call', callTransitions, CallStatus.AUTHORIZED, CallStatus.ACTIVE);
        await this.calls.transitionCall(context, {
          callId: resolved.call.id,
          expected: CallStatus.AUTHORIZED,
          next: CallStatus.ACTIVE,
          occurredAt: event.occurredAt,
        });
      }
      await this.audit.record({
        organizationId: resolved.call.organizationId,
        correlationId: event.eventId,
        idempotencyKey: `livekit:${event.eventId}:participant-joined`,
        action: 'media.participant.joined',
        targetType: 'CallParticipant',
        targetId: resolved.participant.id,
        operation: 'verified-livekit-lifecycle',
      });
      return null;
    }
    if (
      event.eventType === 'participant_left' ||
      event.eventType === 'participant_connection_aborted'
    ) {
      await this.calls.markParticipantEnded(context, resolved.participant.id, event.occurredAt);
      await this.audit.record({
        organizationId: resolved.call.organizationId,
        correlationId: event.eventId,
        idempotencyKey: `livekit:${event.eventId}:participant-ended`,
        action: 'media.participant.ended',
        targetType: 'CallParticipant',
        targetId: resolved.participant.id,
        operation: 'verified-livekit-lifecycle',
      });
      return null;
    }
    if (event.trackSid === undefined) {
      throw new PersistenceConflictError('Verified track SID is required.');
    }
    if (event.eventType === 'track_unpublished') {
      const sessions = await this.calls.closeVerifiedTrack(context, {
        callId: resolved.call.id,
        trackSid: event.trackSid,
        occurredAt: event.occurredAt,
      });
      for (const sessionId of sessions) {
        try {
          if (this.ml === undefined) throw new Error('ML control provider unavailable');
          await this.ml.stopAnalysis({ sessionId, reasonCode: 'TRACK_UNPUBLISHED' });
        } catch {
          await this.audit.record({
            organizationId: resolved.call.organizationId,
            correlationId: event.eventId,
            idempotencyKey: `livekit:${event.eventId}:${sessionId}:stop-failed`,
            action: 'analysis.session.revoke.provider-unknown',
            targetType: 'AnalysisSession',
            targetId: sessionId,
            outcome: AuditOutcome.FAILED,
            reasonCode: 'ML_STOP_FAILED_OR_TIMED_OUT',
            operation: 'track-unpublished',
          });
        }
      }
      await this.audit.record({
        organizationId: resolved.call.organizationId,
        correlationId: event.eventId,
        idempotencyKey: `livekit:${event.eventId}:track-unpublished`,
        action: 'media.track.unpublished',
        targetType: 'Call',
        targetId: resolved.call.id,
        operation: 'track-unpublished',
      });
      return null;
    }
    if (
      resolved.participant.role !== ParticipantRole.CALLER ||
      event.trackSource !== 'MICROPHONE' ||
      (event.mimeType !== undefined && !event.mimeType.toLowerCase().startsWith('audio/'))
    ) {
      throw new PersistenceConflictError('Only the authoritative caller microphone may be bound.');
    }
    if (
      !new Set<CallStatus>([CallStatus.AUTHORIZED, CallStatus.ACTIVE]).has(resolved.call.status)
    ) {
      throw new PersistenceConflictError('Call is not accepting media bindings.');
    }
    const voiceprint =
      resolved.call.expectedTrustedSpeakerId === null
        ? null
        : await this.enrollment.findActiveVoiceprint(
            context,
            resolved.call.expectedTrustedSpeakerId,
          );
    const bound = await this.calls.bindTrackAndCreateAnalysis(context, {
      callId: resolved.call.id,
      participantId: resolved.participant.id,
      trackSid: event.trackSid,
      trackSource: event.trackSource,
      ...(event.mimeType === undefined ? {} : { mimeType: event.mimeType }),
      analysisIdempotencyKey: `livekit:${event.eventId}:analysis`,
      analysisExpiresAt: new Date(
        event.occurredAt.getTime() +
          this.configuration.values.dependencies.analysisSessionTtlSeconds * 1_000,
      ),
      ...(voiceprint === null ? {} : { voiceprintId: voiceprint.id }),
    });
    for (const sessionId of bound.supersededAnalysisSessionIds) {
      try {
        if (this.ml === undefined) throw new Error('ML control provider unavailable');
        await this.ml.stopAnalysis({ sessionId, reasonCode: 'TRACK_SUPERSEDED' });
      } catch {
        await this.audit.record({
          organizationId: resolved.call.organizationId,
          correlationId: event.eventId,
          idempotencyKey: `livekit:${event.eventId}:${sessionId}:superseded-stop-failed`,
          action: 'analysis.session.superseded.provider-unknown',
          targetType: 'AnalysisSession',
          targetId: sessionId,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'ML_STOP_FAILED_OR_TIMED_OUT',
          operation: 'track-republish',
        });
      }
    }
    await this.audit.record({
      organizationId: resolved.call.organizationId,
      correlationId: event.eventId,
      idempotencyKey: `livekit:${event.eventId}:track-bound`,
      action: 'media.track.bound',
      targetType: 'TrackBinding',
      targetId: bound.binding.id,
      operation: 'track-published',
    });
    return this.analysis.start({
      organizationId: resolved.call.organizationId,
      analysisSessionId: bound.analysisSession.id,
      correlationId: event.eventId,
      idempotencyKey: `livekit:${event.eventId}:analysis-start`,
    });
  }
}
