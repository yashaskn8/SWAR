import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { requireIdempotencyKey } from '../../common/api/request-contracts';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequestContextService } from '../../common/logging/request-context.service';
import { ApiRateLimit } from '../../common/rate-limit/api-rate-limit.decorator';
import { ApiRateLimitGuard } from '../../common/rate-limit/api-rate-limit.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { SecurityOperationsService } from './security-operations.service';

@ApiTags('security-operations')
@ApiBearerAuth()
@Controller()
@UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
export class SecurityOperationsController {
  constructor(
    private readonly operations: SecurityOperationsService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Get('alerts/active')
  @RequirePermissions('risk-event.read')
  @ApiRateLimit('QUERY')
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({ summary: 'List active unacknowledged alerts in the authenticated tenant' })
  async alerts(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const page = await this.operations.activeAlerts(principal, cursor, limit);
    return {
      items: page.items.map((alert) => ({
        alertId: alert.id,
        callId: alert.callId,
        riskEventId: alert.riskEventId,
        interventionId: alert.interventionId,
        eventType: alert.eventType,
        state: alert.riskEvent.state,
        mode: alert.mode,
        status: alert.status,
        createdAt: alert.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Post('alerts/:alertId/acknowledge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('intervention.resolve')
  @ApiRateLimit('MUTATION')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Acknowledge a tenant-scoped alert idempotently' })
  async acknowledge(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('alertId', new ParseUUIDPipe()) alertId: string,
    @Headers('idempotency-key') header: string | undefined,
  ) {
    const alert = await this.operations.acknowledgeAlert(principal, {
      alertId,
      idempotencyKey: requireIdempotencyKey(header),
      correlationId: this.requestContext.requireRequestId(),
    });
    return { alertId: alert.id, status: alert.status, acknowledgedAt: alert.acknowledgedAt };
  }

  @Get('security-events')
  @RequirePermissions('risk-event.read')
  @ApiRateLimit('QUERY')
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'callId', required: false, format: 'uuid' })
  @ApiOperation({ summary: 'List paginated tenant security-event history' })
  async securityEvents(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('callId', new ParseUUIDPipe({ optional: true })) callId?: string,
  ) {
    const page = await this.operations.securityEvents(principal, cursor, limit, callId);
    return {
      items: page.items.map((event) => ({
        riskEventId: event.id,
        callId: event.callId,
        eventSequence: event.eventSequence.toString(),
        priorState: event.priorState,
        state: event.state,
        mode: event.mode,
        reasonCode: event.transitionReasonCode,
        policyVersion: event.policyVersion,
        occurredAt: event.occurredAt.toISOString(),
        interventions: event.interventions.map((item) => ({
          interventionId: item.id,
          type: item.type,
          status: item.status,
          mode: item.mode,
        })),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Get('dashboard/summary')
  @RequirePermissions('risk-event.read')
  @ApiRateLimit('QUERY')
  @ApiOperation({ summary: 'Retrieve a tenant-scoped backend security summary' })
  summary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.operations.dashboardSummary(principal);
  }
}
