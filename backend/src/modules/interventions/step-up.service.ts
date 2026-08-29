import { HttpStatus, Injectable } from '@nestjs/common';

import { InterventionType, VerificationStatus } from '../../generated/prisma/client';
import { ApiError } from '../../common/errors/api-error';
import { ConfigurationService } from '../../config/configuration';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { RiskRepository } from '../risk/risk.repository';

@Injectable()
export class StepUpService {
  constructor(
    private readonly risk: RiskRepository,
    private readonly authorization: ResourceAuthorizationService,
    private readonly configuration: ConfigurationService,
  ) {}

  async request(
    principal: AuthPrincipal,
    input: { interventionId: string; method: string; idempotencyKey: string },
  ) {
    this.authorization.assert(principal, 'intervention.resolve', principal.organizationId);
    const context = { organizationId: principal.organizationId };
    const intervention = await this.risk.findIntervention(context, input.interventionId);
    if (
      !new Set<InterventionType>([
        InterventionType.REQUIRE_STEP_UP,
        InterventionType.REQUIRE_CALLBACK,
        InterventionType.HOLD_PROTECTED_ACTION,
      ]).has(intervention.type)
    ) {
      throw new ApiError(
        'STEP_UP_NOT_REQUIRED',
        'The intervention does not permit step-up verification.',
        HttpStatus.CONFLICT,
      );
    }
    return this.risk.createVerificationChallenge(context, {
      callId: intervention.callId,
      interventionId: intervention.id,
      performedByMembershipId: principal.membershipId,
      idempotencyKey: input.idempotencyKey,
      method: input.method,
      attemptNumber: 1,
      expiresAt: new Date(
        Date.now() + this.configuration.values.api.stepUpChallengeTtlSeconds * 1_000,
      ),
    });
  }

  complete(input: {
    organizationId: string;
    challengeId: string;
    result: Extract<VerificationStatus, 'PASSED' | 'FAILED'>;
    resultCode: string;
  }) {
    return this.risk.completeVerificationChallenge(
      { organizationId: input.organizationId },
      { challengeId: input.challengeId, status: input.result, resultCode: input.resultCode },
    );
  }
}
