import { Injectable } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../auth/resource-authorization.service';
import { AuditService } from '../audit/audit.service';
import { SecurityOperationsRepository } from './security-operations.repository';

@Injectable()
export class SecurityOperationsService {
  constructor(
    private readonly repository: SecurityOperationsRepository,
    private readonly authorization: ResourceAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  activeAlerts(principal: AuthPrincipal, cursor?: string, limit?: number) {
    this.authorization.assert(principal, 'risk-event.read', principal.organizationId);
    return this.repository.listActiveAlerts(
      { organizationId: principal.organizationId },
      { ...(cursor === undefined ? {} : { cursor }), ...(limit === undefined ? {} : { limit }) },
    );
  }

  securityEvents(principal: AuthPrincipal, cursor?: string, limit?: number, callId?: string) {
    this.authorization.assert(principal, 'risk-event.read', principal.organizationId);
    return this.repository.listSecurityEvents(
      { organizationId: principal.organizationId },
      {
        ...(cursor === undefined ? {} : { cursor }),
        ...(limit === undefined ? {} : { limit }),
        ...(callId === undefined ? {} : { callId }),
      },
    );
  }

  dashboardSummary(principal: AuthPrincipal) {
    this.authorization.assert(principal, 'risk-event.read', principal.organizationId);
    return this.repository.dashboardSummary({ organizationId: principal.organizationId });
  }

  async acknowledgeAlert(
    principal: AuthPrincipal,
    input: { alertId: string; idempotencyKey: string; correlationId: string },
  ) {
    this.authorization.assert(principal, 'intervention.resolve', principal.organizationId);
    const alert = await this.repository.acknowledgeAlert(
      { organizationId: principal.organizationId },
      input.alertId,
      principal.membershipId,
    );
    await this.audit.record({
      organizationId: principal.organizationId,
      actor: principal,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      action: 'alert.acknowledged',
      targetType: 'Alert',
      targetId: alert.id,
      operation: 'alert-acknowledge',
    });
    return alert;
  }
}
