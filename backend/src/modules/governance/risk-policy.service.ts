import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, RiskPolicy } from '../../generated/prisma/client';
import { ApiError } from '../../common/errors/api-error';
import { ConfigurationService } from '../../config/configuration';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { GovernanceRepository } from './governance.repository';
import { parseRiskPolicyDocument, RiskPolicyValidationError } from '../risk/risk-policy';

@Injectable()
export class RiskPolicyService {
  constructor(
    private readonly governance: GovernanceRepository,
    private readonly authorization: ResourceAuthorizationService,
    private readonly configuration: ConfigurationService,
  ) {}

  active(principal: AuthPrincipal, policyKey: string): Promise<RiskPolicy> {
    this.authorization.assert(principal, 'risk-policy.read', principal.organizationId);
    return this.governance.findActiveRiskPolicy(
      { organizationId: principal.organizationId },
      policyKey,
    );
  }

  async put(
    principal: AuthPrincipal,
    input: {
      policyKey: string;
      version: string;
      schemaVersion: string;
      policyDocument: Record<string, unknown>;
      activate: boolean;
    },
  ): Promise<RiskPolicy> {
    this.authorization.assert(principal, 'risk-policy.manage', principal.organizationId);
    let policyDocument;
    try {
      policyDocument = parseRiskPolicyDocument(input.policyDocument);
    } catch (error) {
      if (!(error instanceof RiskPolicyValidationError)) throw error;
      throw new ApiError(
        'RISK_POLICY_INVALID',
        'The versioned risk policy document is invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      policyDocument.activationMode === 'PRODUCTION' &&
      (this.configuration.values.risk.interventionMode !== 'PRODUCTION' ||
        this.configuration.values.risk.phaseOScientificStatus !== 'PROMOTED' ||
        this.configuration.values.risk.phasePProductionStatus !== 'PROMOTED' ||
        this.configuration.values.risk.phaseQProductionStatus !== 'PROMOTED')
    ) {
      throw new ApiError(
        'RISK_PRODUCTION_ACTIVATION_BLOCKED',
        'Production risk activation is blocked by upstream promotion gates.',
        HttpStatus.CONFLICT,
      );
    }
    const created = await this.governance.createRiskPolicy(
      { organizationId: principal.organizationId },
      {
        policyKey: input.policyKey,
        version: input.version,
        schemaVersion: input.schemaVersion,
        policyDocument: policyDocument as unknown as Prisma.InputJsonValue,
        createdByMembershipId: principal.membershipId,
      },
    );
    return input.activate
      ? this.governance.activateRiskPolicy({ organizationId: principal.organizationId }, created.id)
      : created;
  }
}
