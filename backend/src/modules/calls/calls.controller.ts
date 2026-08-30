import {
  Body,
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
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { requireIdempotencyKey } from '../../common/api/request-contracts';
import { RequestContextService } from '../../common/logging/request-context.service';
import { ApiRateLimit } from '../../common/rate-limit/api-rate-limit.decorator';
import { ApiRateLimitGuard } from '../../common/rate-limit/api-rate-limit.guard';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CallQueriesService } from './call-queries.service';
import { CreateCallDto, InviteParticipantDto, JoinCallDto } from './calls.contracts';
import { CallsService } from './calls.service';

function callView(call: {
  id: string;
  status: string;
  riskPolicyVersion: string;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}) {
  return {
    callId: call.id,
    status: call.status,
    riskPolicyVersion: call.riskPolicyVersion,
    createdAt: call.createdAt.toISOString(),
    startedAt: call.startedAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
  };
}

@ApiTags('calls')
@ApiBearerAuth()
@Controller('calls')
@UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly queries: CallQueriesService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('call.create')
  @ApiRateLimit('MUTATION')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Authorize and create a controlled WebRTC call' })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreateCallDto,
  ) {
    const call = await this.calls.create(principal, {
      ...body,
      idempotencyKey: requireIdempotencyKey(key),
      correlationId: this.requestContext.requireRequestId(),
    });
    return callView(call);
  }

  @Post(':callId/participants')
  @RequirePermissions('call.create')
  @ApiRateLimit('MUTATION')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Authorize a participant and issue a short-lived room grant' })
  async invite(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('callId', new ParseUUIDPipe()) callId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: InviteParticipantDto,
  ) {
    const result = await this.calls.invite(principal, {
      ...body,
      callId,
      idempotencyKey: requireIdempotencyKey(key),
      correlationId: this.requestContext.requireRequestId(),
    });
    return {
      participantId: result.participant.id,
      role: result.participant.role,
      roomName: result.grant.roomName,
      participantIdentity: result.grant.participantIdentity,
      joinToken: result.grant.token,
      expiresAt: result.grant.expiresAt.toISOString(),
    };
  }

  @Post(':callId/join-token')
  @RequirePermissions('call.read')
  @ApiRateLimit('SENSITIVE')
  @ApiOperation({ summary: 'Issue a fresh short-lived grant to the authorized participant' })
  async join(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('callId', new ParseUUIDPipe()) callId: string,
    @Body() body: JoinCallDto,
  ) {
    const grant = await this.calls.answer(principal, {
      callId,
      participantId: body.participantId,
      correlationId: this.requestContext.requireRequestId(),
    });
    return {
      roomName: grant.roomName,
      participantIdentity: grant.participantIdentity,
      joinToken: grant.token,
      expiresAt: grant.expiresAt.toISOString(),
    };
  }

  @Post(':callId/end')
  @RequirePermissions('call.end')
  @ApiRateLimit('MUTATION')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'End a controlled call and revoke associated analysis' })
  async end(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('callId', new ParseUUIDPipe()) callId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return callView(
      await this.calls.end(principal, {
        callId,
        idempotencyKey: requireIdempotencyKey(key),
        correlationId: this.requestContext.requireRequestId(),
      }),
    );
  }

  @Get('active')
  @RequirePermissions('call.read')
  @ApiRateLimit('QUERY')
  @ApiOperation({ summary: 'List active calls in the authenticated organization' })
  async active(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const page = await this.queries.active(principal, cursor, limit);
    return { items: page.items.map(callView), nextCursor: page.nextCursor };
  }

  @Get(':callId/risk-events')
  @RequirePermissions('risk-event.read')
  @ApiRateLimit('QUERY')
  @ApiOperation({ summary: 'List versioned risk-state transitions for an authorized call' })
  async riskEvents(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('callId', new ParseUUIDPipe()) callId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const page = await this.queries.riskEvents(principal, callId, cursor, limit);
    return {
      items: page.items.map((event) => ({
        riskEventId: event.id,
        callId: event.callId,
        eventSequence: event.eventSequence.toString(),
        priorState: event.priorState,
        state: event.state,
        reasonCode: event.transitionReasonCode,
        policyVersion: event.policyVersion,
        thresholdVersion: event.thresholdVersion,
        occurredAt: event.occurredAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':callId/risk-assessments')
  @RequirePermissions('risk-event.read')
  @ApiRateLimit('QUERY')
  @ApiOperation({
    summary: 'List tenant-scoped engineering/shadow risk assessments and activation status',
  })
  async riskAssessments(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('callId', new ParseUUIDPipe()) callId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const page = await this.queries.riskAssessments(principal, callId, cursor, limit);
    return {
      items: page.items.map((assessment) => ({
        riskAssessmentId: assessment.id,
        callId: assessment.callId,
        outcome: assessment.outcome,
        effectiveState: assessment.effectiveState,
        decisionMode: assessment.decisionMode,
        evidenceMode: assessment.evidenceMode,
        productionEligible: assessment.productionEligible,
        activationSuppressed: assessment.activationSuppressed,
        reasonCode: assessment.reasonCode,
        policyVersion: assessment.policyVersion,
        thresholdVersion: assessment.thresholdVersion,
        calibrationVersion: assessment.calibrationVersion,
        proposedInterventions: assessment.proposedInterventions,
        maxWindowSequence: assessment.maxWindowSequence.toString(),
        occurredAt: assessment.occurredAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }
}
