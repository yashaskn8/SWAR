import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AuditOutcome,
  ConsentStatus,
  type EnrollmentConsent,
  type TrustedSpeaker,
  type Voiceprint,
} from '../../generated/prisma/client';
import { MlControlPort } from '../../integrations/ml/ml-control.port';
import { PersistenceConflictError } from '../../database/database.errors';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { AuditService } from '../audit/audit.service';
import { DomainProviderError } from '../domain/domain.errors';
import { assertTransition, consentTransitions } from '../domain/domain-state-machines';
import { EnrollmentRepository } from '../enrollment/enrollment.repository';

@Injectable()
export class TrustedSpeakersService {
  constructor(
    private readonly enrollment: EnrollmentRepository,
    private readonly authorization: ResourceAuthorizationService,
    private readonly audit: AuditService,
    @Optional() @Inject(MlControlPort) private readonly ml?: MlControlPort,
  ) {}

  async create(
    principal: AuthPrincipal,
    input: {
      userId?: string;
      externalReference?: string;
      label: string;
      correlationId: string;
      idempotencyKey?: string;
    },
  ): Promise<TrustedSpeaker> {
    this.authorization.assert(principal, 'enrollment.manage', principal.organizationId);
    const speaker = await this.enrollment.createTrustedSpeaker(
      { organizationId: principal.organizationId },
      {
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(input.externalReference === undefined
          ? {}
          : { externalReference: input.externalReference }),
        label: input.label,
      },
    );
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: input.correlationId,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      action: 'trusted-speaker.created',
      targetType: 'TrustedSpeaker',
      targetId: speaker.id,
      operation: 'trusted-speaker-create',
    });
    return speaker;
  }

  async grantConsent(
    principal: AuthPrincipal,
    input: {
      trustedSpeakerId: string;
      purposeCode: string;
      noticeVersion: string;
      consentAffirmed: true;
      expiresAt?: Date;
      correlationId: string;
    },
  ): Promise<EnrollmentConsent> {
    this.authorization.assert(principal, 'enrollment.manage', principal.organizationId);
    if (input.consentAffirmed !== true) {
      throw new PersistenceConflictError('Explicit enrollment consent is required.');
    }
    await this.enrollment.findTrustedSpeaker(
      { organizationId: principal.organizationId },
      input.trustedSpeakerId,
    );
    const consent = await this.enrollment.grantConsent(
      { organizationId: principal.organizationId },
      {
        trustedSpeakerId: input.trustedSpeakerId,
        grantedByMembershipId: principal.membershipId,
        purposeCode: input.purposeCode,
        noticeVersion: input.noticeVersion,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      },
    );
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: input.correlationId,
      action: 'enrollment.consent.granted',
      targetType: 'EnrollmentConsent',
      targetId: consent.id,
      operation: 'consent-grant',
    });
    return consent;
  }

  async revokeConsent(
    principal: AuthPrincipal,
    input: {
      consentId: string;
      reasonCode: string;
      idempotencyKey: string;
      correlationId: string;
    },
  ): Promise<EnrollmentConsent> {
    this.authorization.assert(principal, 'enrollment.manage', principal.organizationId);
    const current = await this.enrollment.findConsent(
      { organizationId: principal.organizationId },
      input.consentId,
    );
    if (current.status !== ConsentStatus.REVOKED) {
      assertTransition(
        'EnrollmentConsent',
        consentTransitions,
        current.status,
        ConsentStatus.REVOKED,
      );
    }
    const result = await this.enrollment.revokeConsent(
      { organizationId: principal.organizationId },
      { consentId: input.consentId, reasonCode: input.reasonCode },
    );
    try {
      if (result.revokedAnalysisSessionIds.length > 0 && this.ml === undefined) {
        throw new Error('ML control provider unavailable');
      }
      for (const sessionId of result.revokedAnalysisSessionIds) {
        await this.ml!.stopAnalysis({ sessionId, reasonCode: 'CONSENT_REVOKED' });
      }
    } catch {
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:ml-clear-failed`,
        action: 'enrollment.consent.revoked.ml-clear-failed',
        targetType: 'EnrollmentConsent',
        targetId: result.consent.id,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'ML_CLEAR_FAILED',
        operation: 'consent-revoke',
      });
      throw new DomainProviderError('ML', 'consent-revocation-clear', ConsentStatus.REVOKED);
    }
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: input.correlationId,
      idempotencyKey: `${input.idempotencyKey}:revoked`,
      action: 'enrollment.consent.revoked',
      targetType: 'EnrollmentConsent',
      targetId: result.consent.id,
      reasonCode: input.reasonCode,
      operation: 'consent-revoke',
    });
    return result.consent;
  }

  async deleteVoiceprint(
    principal: AuthPrincipal,
    input: {
      voiceprintId: string;
      idempotencyKey: string;
      correlationId: string;
    },
  ): Promise<Voiceprint> {
    this.authorization.assert(principal, 'voiceprint.delete', principal.organizationId);
    const result = await this.enrollment.deleteVoiceprint(
      { organizationId: principal.organizationId },
      input.voiceprintId,
    );
    try {
      if (result.revokedAnalysisSessionIds.length > 0 && this.ml === undefined) {
        throw new Error('ML control provider unavailable');
      }
      for (const sessionId of result.revokedAnalysisSessionIds) {
        await this.ml!.stopAnalysis({ sessionId, reasonCode: 'VOICEPRINT_DELETED' });
      }
    } catch {
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:ml-clear-failed`,
        action: 'voiceprint.deleted.ml-clear-failed',
        targetType: 'Voiceprint',
        targetId: result.voiceprint.id,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'ML_CLEAR_FAILED',
        operation: 'voiceprint-delete',
      });
      throw new DomainProviderError('ML', 'voiceprint-deletion-clear', 'DELETED');
    }
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: input.correlationId,
      idempotencyKey: `${input.idempotencyKey}:deleted`,
      action: 'voiceprint.deleted',
      targetType: 'Voiceprint',
      targetId: result.voiceprint.id,
      operation: 'voiceprint-delete',
    });
    return result.voiceprint;
  }
}
