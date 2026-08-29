import { Injectable } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { RiskRepository } from '../risk/risk.repository';
import { CallRepository } from './call.repository';

@Injectable()
export class CallQueriesService {
  constructor(
    private readonly calls: CallRepository,
    private readonly risk: RiskRepository,
    private readonly authorization: ResourceAuthorizationService,
  ) {}

  async assertReadable(principal: AuthPrincipal, callId: string): Promise<void> {
    this.authorization.assert(principal, 'call.read', principal.organizationId);
    await this.calls.findCallAggregate({ organizationId: principal.organizationId }, callId);
  }

  async active(principal: AuthPrincipal, cursor?: string, limit?: number) {
    this.authorization.assert(principal, 'call.read', principal.organizationId);
    return this.calls.listActiveCalls(
      { organizationId: principal.organizationId },
      { ...(cursor === undefined ? {} : { cursor }), ...(limit === undefined ? {} : { limit }) },
    );
  }

  async riskEvents(principal: AuthPrincipal, callId: string, cursor?: string, limit?: number) {
    this.authorization.assert(principal, 'risk-event.read', principal.organizationId);
    await this.calls.findCallAggregate({ organizationId: principal.organizationId }, callId);
    return this.risk.listRiskEvents({ organizationId: principal.organizationId }, callId, {
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit }),
    });
  }
}
