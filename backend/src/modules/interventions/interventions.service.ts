import { Inject, Injectable } from '@nestjs/common';

import {
  AuditOutcome,
  InterventionStatus,
  InterventionType,
  type Intervention,
} from '../../generated/prisma/client';
import { PersistenceConflictError } from '../../database/database.errors';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { AuditService } from '../audit/audit.service';
import { DomainProviderError } from '../domain/domain.errors';
import { assertTransition, interventionTransitions } from '../domain/domain-state-machines';
import { RiskRepository } from '../risk/risk.repository';
import { InterventionPort } from './intervention.port';

@Injectable()
export class InterventionsService {
  constructor(
    private readonly risk: RiskRepository,
    private readonly authorization: ResourceAuthorizationService,
    private readonly audit: AuditService,
    @Inject(InterventionPort) private readonly provider: InterventionPort,
  ) {}

  async acknowledge(
    principal: AuthPrincipal,
    input: { interventionId: string; correlationId: string },
  ): Promise<Intervention> {
    this.authorization.assert(principal, 'intervention.resolve', principal.organizationId);
    const context = { organizationId: principal.organizationId };
    const current = await this.risk.findIntervention(context, input.interventionId);
    if (current.status === InterventionStatus.ACKNOWLEDGED) return current;
    assertTransition(
      'Intervention',
      interventionTransitions,
      current.status,
      InterventionStatus.ACKNOWLEDGED,
    );
    const acknowledged = await this.risk.updateInterventionStatus(context, {
      interventionId: current.id,
      expectedStatus: current.status,
      nextStatus: InterventionStatus.ACKNOWLEDGED,
      resolvedByMembershipId: principal.membershipId,
    });
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: input.correlationId,
      action: 'intervention.acknowledged',
      targetType: 'Intervention',
      targetId: acknowledged.id,
      operation: 'intervention-acknowledge',
    });
    return acknowledged;
  }

  async hold(
    principal: AuthPrincipal,
    input: { interventionId: string; idempotencyKey: string; correlationId: string },
  ): Promise<Intervention> {
    this.authorization.assert(principal, 'intervention.resolve', principal.organizationId);
    const context = { organizationId: principal.organizationId };
    const current = await this.risk.findIntervention(context, input.interventionId);
    if (
      current.type !== InterventionType.HOLD_PROTECTED_ACTION ||
      current.protectedActionReference === null
    ) {
      throw new PersistenceConflictError('Intervention is not a protected-action hold.');
    }
    if (current.status === InterventionStatus.IN_PROGRESS) return current;
    assertTransition(
      'Intervention',
      interventionTransitions,
      current.status,
      InterventionStatus.IN_PROGRESS,
    );
    try {
      await this.provider.hold({
        organizationId: principal.organizationId,
        interventionId: current.id,
        protectedActionReference: current.protectedActionReference,
        idempotencyKey: input.idempotencyKey,
      });
    } catch {
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:hold-failed`,
        action: 'intervention.hold.provider-unknown',
        targetType: 'Intervention',
        targetId: current.id,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'PROTECTED_ACTION_HOLD_FAILED_OR_TIMED_OUT',
        operation: 'intervention-hold',
      });
      throw new DomainProviderError('PROTECTED_ACTION', 'hold', current.status);
    }
    const held = await this.risk.updateInterventionStatus(context, {
      interventionId: current.id,
      expectedStatus: current.status,
      nextStatus: InterventionStatus.IN_PROGRESS,
    });
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: input.correlationId,
      idempotencyKey: `${input.idempotencyKey}:held`,
      action: 'intervention.hold.applied',
      targetType: 'Intervention',
      targetId: held.id,
      operation: 'intervention-hold',
    });
    return held;
  }

  async releaseAfterIndependentVerification(
    principal: AuthPrincipal,
    input: {
      interventionId: string;
      verificationChallengeId: string;
      idempotencyKey: string;
      correlationId: string;
    },
  ): Promise<Intervention> {
    this.authorization.assert(principal, 'intervention.resolve', principal.organizationId);
    const context = { organizationId: principal.organizationId };
    const current = await this.risk.findIntervention(context, input.interventionId);
    const challenge = await this.risk.findVerificationChallenge(
      context,
      input.verificationChallengeId,
    );
    if (
      current.type !== InterventionType.HOLD_PROTECTED_ACTION ||
      current.protectedActionReference === null ||
      current.status !== InterventionStatus.IN_PROGRESS ||
      challenge.interventionId !== current.id ||
      challenge.callId !== current.callId ||
      challenge.status !== 'PASSED' ||
      challenge.expiresAt <= new Date()
    ) {
      throw new PersistenceConflictError('Active protected-action hold was not found.');
    }
    assertTransition(
      'Intervention',
      interventionTransitions,
      current.status,
      InterventionStatus.SATISFIED,
    );
    try {
      await this.provider.release({
        organizationId: principal.organizationId,
        interventionId: current.id,
        protectedActionReference: current.protectedActionReference,
        idempotencyKey: input.idempotencyKey,
      });
    } catch {
      await this.audit.record({
        organizationId: principal.organizationId,
        actor: principal,
        correlationId: input.correlationId,
        idempotencyKey: `${input.idempotencyKey}:release-failed`,
        action: 'intervention.release.provider-unknown',
        targetType: 'Intervention',
        targetId: current.id,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'PROTECTED_ACTION_RELEASE_FAILED_OR_TIMED_OUT',
        operation: 'intervention-release',
      });
      throw new DomainProviderError('PROTECTED_ACTION', 'release', InterventionStatus.IN_PROGRESS);
    }
    const released = await this.risk.updateInterventionStatus(context, {
      interventionId: current.id,
      expectedStatus: InterventionStatus.IN_PROGRESS,
      nextStatus: InterventionStatus.SATISFIED,
      resolvedByMembershipId: principal.membershipId,
    });
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: input.correlationId,
      idempotencyKey: `${input.idempotencyKey}:released`,
      action: 'intervention.hold.released',
      targetType: 'Intervention',
      targetId: released.id,
      operation: 'intervention-release',
    });
    return released;
  }
}
