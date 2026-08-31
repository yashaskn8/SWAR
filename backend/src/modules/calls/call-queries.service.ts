import { Injectable } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { RiskRepository } from '../risk/risk.repository';
import { CallRepository } from './call.repository';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class CallQueriesService {
  constructor(
    private readonly calls: CallRepository,
    private readonly risk: RiskRepository,
    private readonly authorization: ResourceAuthorizationService,
    private readonly prisma: PrismaService,
  ) {}

  async assertReadable(principal: AuthPrincipal, callId: string): Promise<void> {
    this.authorization.assert(principal, 'call.read', principal.organizationId);
    await this.calls.findCallAggregate({ organizationId: principal.organizationId }, callId);
  }

  async current(principal: AuthPrincipal, callId: string) {
    this.authorization.assert(principal, 'call.read', principal.organizationId);
    const aggregate = await this.calls.findCallAggregate(
      { organizationId: principal.organizationId },
      callId,
    );
    const [assessment, riskEvent, interventions] = await Promise.all([
      this.prisma.client.riskAssessment.findFirst({
        where: { organizationId: principal.organizationId, callId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.client.riskEvent.findFirst({
        where: { organizationId: principal.organizationId, callId },
        orderBy: [{ eventSequence: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.client.intervention.findMany({
        where: {
          organizationId: principal.organizationId,
          callId,
          status: { in: ['REQUIRED', 'ACKNOWLEDGED', 'IN_PROGRESS'] },
        },
        orderBy: [{ requiredAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return { ...aggregate, assessment, riskEvent, interventions };
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

  async riskAssessments(principal: AuthPrincipal, callId: string, cursor?: string, limit?: number) {
    this.authorization.assert(principal, 'risk-event.read', principal.organizationId);
    await this.calls.findCallAggregate({ organizationId: principal.organizationId }, callId);
    return this.risk.listRiskAssessments({ organizationId: principal.organizationId }, callId, {
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit }),
    });
  }
}
