import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AuditOutcome,
  ConsentStatus,
  VoiceprintStatus,
  type Voiceprint,
} from '../../generated/prisma/client';
import { MlControlPort } from '../../integrations/ml/ml-control.port';
import { PersistenceConflictError } from '../../database/database.errors';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { AuditService } from '../audit/audit.service';
import { DomainProviderError } from '../domain/domain.errors';
import { assertTransition, voiceprintTransitions } from '../domain/domain-state-machines';
import { EnrollmentRepository } from '../enrollment/enrollment.repository';
import { EphemeralEnrollmentAudio } from './ephemeral-audio';
import { VoiceprintCipherService } from './voiceprint-cipher.service';

@Injectable()
export class VoiceEnrollmentService {
  constructor(
    private readonly enrollment: EnrollmentRepository,
    private readonly authorization: ResourceAuthorizationService,
    private readonly cipher: VoiceprintCipherService,
    private readonly audit: AuditService,
    @Optional() @Inject(MlControlPort) private readonly ml?: MlControlPort,
  ) {}

  async enroll(
    principal: AuthPrincipal,
    input: {
      enrollmentOperationId: string;
      trustedSpeakerId: string;
      consentId: string;
      expectedModelVersionId: string;
      audio: EphemeralEnrollmentAudio;
      idempotencyKey: string;
      correlationId: string;
    },
  ): Promise<Voiceprint> {
    this.authorization.assert(principal, 'enrollment.manage', principal.organizationId);
    const context = { organizationId: principal.organizationId };
    const consent = await this.enrollment.findConsent(context, input.consentId);
    if (
      consent.trustedSpeakerId !== input.trustedSpeakerId ||
      consent.status !== ConsentStatus.GRANTED ||
      (consent.expiresAt !== null && consent.expiresAt <= new Date())
    ) {
      input.audio.clear();
      throw new PersistenceConflictError('Active matching enrollment consent is required.');
    }
    let embedding: Uint8Array | undefined;
    try {
      if (this.ml === undefined) throw new Error('ML control provider unavailable');
      const result = await this.ml.inferEnrollment({
        enrollmentOperationId: input.enrollmentOperationId,
        consentId: consent.id,
        samples: input.audio.view(),
      });
      embedding = result.embedding;
      if (
        result.modelVersionId !== input.expectedModelVersionId ||
        result.acceptedSampleCount < 1 ||
        result.embedding.byteLength === 0
      ) {
        throw new PersistenceConflictError('Enrollment result does not match authorization.');
      }
      const envelope = this.cipher.encrypt({
        embedding: result.embedding,
        embeddingFormat: result.embeddingFormat,
        sampleCount: result.acceptedSampleCount,
      });
      assertTransition(
        'Voiceprint',
        voiceprintTransitions,
        VoiceprintStatus.ENROLLING,
        VoiceprintStatus.ACTIVE,
      );
      const voiceprint = await this.enrollment.activateVoiceprint(context, {
        trustedSpeakerId: input.trustedSpeakerId,
        consentId: input.consentId,
        modelVersionId: result.modelVersionId,
        createdByMembershipId: principal.membershipId,
        envelope,
      });
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:activated`,
        action: 'voiceprint.activated',
        targetType: 'Voiceprint',
        targetId: voiceprint.id,
        operation: 'voice-enrollment',
      });
      return voiceprint;
    } catch (error) {
      assertTransition(
        'Voiceprint',
        voiceprintTransitions,
        VoiceprintStatus.ENROLLING,
        VoiceprintStatus.FAILED,
      );
      let cancellationFailed = false;
      if (this.ml === undefined) {
        cancellationFailed = true;
      } else {
        try {
          await this.ml.cancelEnrollment({
            enrollmentOperationId: input.enrollmentOperationId,
            reasonCode: 'ENROLLMENT_FAILED',
          });
        } catch {
          cancellationFailed = true;
        }
      }
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:failed`,
        action: 'voiceprint.enrollment.failed',
        targetType: 'TrustedSpeaker',
        targetId: input.trustedSpeakerId,
        outcome: AuditOutcome.FAILED,
        reasonCode: cancellationFailed
          ? 'ENROLLMENT_FAILED_AND_CANCELLATION_UNCONFIRMED'
          : 'ENROLLMENT_PROVIDER_OR_VALIDATION_FAILED',
        operation: 'voice-enrollment',
      });
      if (error instanceof PersistenceConflictError) throw error;
      throw new DomainProviderError('ML', 'enrollment-inference', VoiceprintStatus.FAILED);
    } finally {
      embedding?.fill(0);
      input.audio.clear();
    }
  }
}
