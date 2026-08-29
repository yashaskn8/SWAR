import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AnalysisSessionStatus,
  AuditOutcome,
  type AnalysisSession,
} from '../../generated/prisma/client';
import { MlControlPort } from '../../integrations/ml/ml-control.port';
import { PersistenceConflictError } from '../../database/database.errors';
import { AuditService } from '../audit/audit.service';
import { CallRepository } from '../calls/call.repository';
import { DomainProviderError } from '../domain/domain.errors';
import { analysisTransitions, assertTransition } from '../domain/domain-state-machines';
import { EnrollmentRepository } from '../enrollment/enrollment.repository';

@Injectable()
export class AnalysisService {
  constructor(
    private readonly calls: CallRepository,
    private readonly enrollment: EnrollmentRepository,
    private readonly audit: AuditService,
    @Optional() @Inject(MlControlPort) private readonly ml?: MlControlPort,
  ) {}

  async start(input: {
    organizationId: string;
    analysisSessionId: string;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<AnalysisSession> {
    const context = { organizationId: input.organizationId };
    const grant = await this.calls.findAnalysisGrantContext(context, input.analysisSessionId);
    if (grant.session.status === AnalysisSessionStatus.ACTIVE) return grant.session;
    if (
      grant.session.status !== AnalysisSessionStatus.AUTHORIZED &&
      grant.session.status !== AnalysisSessionStatus.STARTING
    ) {
      throw new PersistenceConflictError('Analysis session cannot start from its current state.');
    }
    if (grant.session.expiresAt <= new Date()) {
      assertTransition(
        'AnalysisSession',
        analysisTransitions,
        grant.session.status,
        AnalysisSessionStatus.EXPIRED,
      );
      return this.calls.transitionAnalysisSession(context, {
        analysisSessionId: grant.session.id,
        expected: grant.session.status,
        next: AnalysisSessionStatus.EXPIRED,
        occurredAt: new Date(),
      });
    }
    if (grant.session.voiceprintId !== null) {
      if (grant.call.expectedTrustedSpeakerId === null) {
        throw new PersistenceConflictError('Analysis voiceprint is not authorized by the call.');
      }
      const current = await this.enrollment.findActiveVoiceprint(
        context,
        grant.call.expectedTrustedSpeakerId,
      );
      if (current?.id !== grant.session.voiceprintId) {
        await this.calls.transitionAnalysisSession(context, {
          analysisSessionId: grant.session.id,
          expected: grant.session.status,
          next: AnalysisSessionStatus.REVOKED,
          failureCode: 'VOICEPRINT_NOT_ACTIVE',
          occurredAt: new Date(),
        });
        throw new PersistenceConflictError('Analysis voiceprint is no longer active.');
      }
    }
    if (grant.session.status === AnalysisSessionStatus.AUTHORIZED) {
      assertTransition(
        'AnalysisSession',
        analysisTransitions,
        AnalysisSessionStatus.AUTHORIZED,
        AnalysisSessionStatus.STARTING,
      );
      await this.calls.transitionAnalysisSession(context, {
        analysisSessionId: grant.session.id,
        expected: AnalysisSessionStatus.AUTHORIZED,
        next: AnalysisSessionStatus.STARTING,
        occurredAt: new Date(),
      });
    }
    try {
      if (this.ml === undefined) throw new Error('ML control provider unavailable');
      await this.ml.startAnalysis({
        sessionId: grant.session.id,
        callId: grant.call.id,
        roomName: grant.call.roomName,
        participantIdentity: grant.participant.livekitIdentity,
        trackSid: grant.mediaTrack.trackSid,
        bindingId: grant.binding.id,
        bindingRevision: grant.binding.revision,
        expiresAt: grant.session.expiresAt,
        ...(grant.session.voiceprintId === null
          ? {}
          : { voiceprintId: grant.session.voiceprintId }),
      });
      assertTransition(
        'AnalysisSession',
        analysisTransitions,
        AnalysisSessionStatus.STARTING,
        AnalysisSessionStatus.ACTIVE,
      );
      const active = await this.calls.transitionAnalysisSession(context, {
        analysisSessionId: grant.session.id,
        expected: AnalysisSessionStatus.STARTING,
        next: AnalysisSessionStatus.ACTIVE,
        occurredAt: new Date(),
      });
      await this.audit.record({
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:active`,
        action: 'analysis.session.active',
        targetType: 'AnalysisSession',
        targetId: active.id,
        operation: 'analysis-start',
      });
      return active;
    } catch {
      await this.audit.record({
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:start-pending`,
        action: 'analysis.session.start.provider-unknown',
        targetType: 'AnalysisSession',
        targetId: grant.session.id,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'ML_START_FAILED_OR_TIMED_OUT',
        operation: 'analysis-start',
      });
      throw new DomainProviderError('ML', 'analysis-start', AnalysisSessionStatus.STARTING);
    }
  }

  async stop(input: {
    organizationId: string;
    analysisSessionId: string;
    reasonCode: string;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<AnalysisSession> {
    const context = { organizationId: input.organizationId };
    const grant = await this.calls.findAnalysisGrantContext(context, input.analysisSessionId);
    if (grant.session.status === AnalysisSessionStatus.STOPPED) return grant.session;
    if (
      grant.session.status === AnalysisSessionStatus.AUTHORIZED ||
      grant.session.status === AnalysisSessionStatus.STARTING
    ) {
      assertTransition(
        'AnalysisSession',
        analysisTransitions,
        grant.session.status,
        AnalysisSessionStatus.REVOKED,
      );
      const stopped = await this.calls.transitionAnalysisSession(context, {
        analysisSessionId: grant.session.id,
        expected: grant.session.status,
        next: AnalysisSessionStatus.REVOKED,
        occurredAt: new Date(),
      });
      await this.audit.record({
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:stopped`,
        action: 'analysis.session.stopped',
        targetType: 'AnalysisSession',
        targetId: stopped.id,
        reasonCode: input.reasonCode,
        operation: 'analysis-stop',
      });
      return stopped;
    }
    if (
      grant.session.status !== AnalysisSessionStatus.ACTIVE &&
      grant.session.status !== AnalysisSessionStatus.DEGRADED &&
      grant.session.status !== AnalysisSessionStatus.STOPPING
    ) {
      throw new PersistenceConflictError('Analysis session cannot stop from its current state.');
    }
    if (grant.session.status !== AnalysisSessionStatus.STOPPING) {
      assertTransition(
        'AnalysisSession',
        analysisTransitions,
        grant.session.status,
        AnalysisSessionStatus.STOPPING,
      );
      await this.calls.transitionAnalysisSession(context, {
        analysisSessionId: grant.session.id,
        expected: grant.session.status,
        next: AnalysisSessionStatus.STOPPING,
        occurredAt: new Date(),
      });
    }
    try {
      if (this.ml === undefined) throw new Error('ML control provider unavailable');
      await this.ml.stopAnalysis({ sessionId: grant.session.id, reasonCode: input.reasonCode });
      assertTransition(
        'AnalysisSession',
        analysisTransitions,
        AnalysisSessionStatus.STOPPING,
        AnalysisSessionStatus.STOPPED,
      );
      return this.calls.transitionAnalysisSession(context, {
        analysisSessionId: grant.session.id,
        expected: AnalysisSessionStatus.STOPPING,
        next: AnalysisSessionStatus.STOPPED,
        occurredAt: new Date(),
      });
    } catch {
      await this.audit.record({
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:stop-pending`,
        action: 'analysis.session.stop.provider-unknown',
        targetType: 'AnalysisSession',
        targetId: grant.session.id,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'ML_STOP_FAILED_OR_TIMED_OUT',
        operation: 'analysis-stop',
      });
      throw new DomainProviderError('ML', 'analysis-stop', AnalysisSessionStatus.STOPPING);
    }
  }
}
