import { Injectable } from '@nestjs/common';
import type { Prisma, RiskPolicy } from '../../generated/prisma/client';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { GovernanceRepository } from './governance.repository';

@Injectable()
export class RiskPolicyService {
  constructor(
    private readonly governance: GovernanceRepository,
    private readonly authorization: ResourceAuthorizationService,
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
    const created = await this.governance.createRiskPolicy(
      { organizationId: principal.organizationId },
      {
        policyKey: input.policyKey,
        version: input.version,
        schemaVersion: input.schemaVersion,
        policyDocument: input.policyDocument as Prisma.InputJsonValue,
        createdByMembershipId: principal.membershipId,
      },
    );
    return input.activate
      ? this.governance.activateRiskPolicy({ organizationId: principal.organizationId }, created.id)
      : created;
  }
}
