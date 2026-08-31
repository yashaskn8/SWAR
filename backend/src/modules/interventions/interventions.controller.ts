import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { requireIdempotencyKey } from '../../common/api/request-contracts';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequestContextService } from '../../common/logging/request-context.service';
import { ApiRateLimit } from '../../common/rate-limit/api-rate-limit.decorator';
import { ApiRateLimitGuard } from '../../common/rate-limit/api-rate-limit.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireInternalService } from '../auth/decorators/internal-service.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import {
  CompleteVerificationChallengeDto,
  CreateVerificationChallengeDto,
  ReleaseInterventionDto,
  CancelInterventionDto,
} from './interventions.contracts';
import { InterventionsService } from './interventions.service';
import { StepUpService } from './step-up.service';

@ApiTags('interventions')
@Controller()
export class InterventionsController {
  constructor(
    private readonly interventions: InterventionsService,
    private readonly stepUp: StepUpService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Post('interventions/:interventionId/acknowledge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
  @ApiBearerAuth()
  @RequirePermissions('intervention.resolve')
  @ApiRateLimit('MUTATION')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Acknowledge a tenant-scoped intervention idempotently' })
  async acknowledge(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('interventionId', new ParseUUIDPipe()) interventionId: string,
    @Headers('idempotency-key') header: string | undefined,
  ) {
    const intervention = await this.interventions.acknowledge(principal, {
      interventionId,
      idempotencyKey: requireIdempotencyKey(header),
      correlationId: this.requestContext.requireRequestId(),
    });
    return { interventionId: intervention.id, status: intervention.status };
  }

  @Post('interventions/:interventionId/hold')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
  @ApiBearerAuth()
  @RequirePermissions('intervention.resolve')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Apply an authorized demo protected-action hold idempotently' })
  async hold(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('interventionId', new ParseUUIDPipe()) interventionId: string,
    @Headers('idempotency-key') header: string | undefined,
  ) {
    const intervention = await this.interventions.hold(principal, {
      interventionId,
      idempotencyKey: requireIdempotencyKey(header),
      correlationId: this.requestContext.requireRequestId(),
    });
    return { interventionId: intervention.id, status: intervention.status };
  }

  @Post('interventions/:interventionId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
  @ApiBearerAuth()
  @RequirePermissions('intervention.resolve')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Cancel a pending intervention without releasing an active hold' })
  async cancel(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('interventionId', new ParseUUIDPipe()) interventionId: string,
    @Headers('idempotency-key') header: string | undefined,
    @Body() body: CancelInterventionDto,
  ) {
    const intervention = await this.interventions.cancel(principal, {
      interventionId,
      idempotencyKey: requireIdempotencyKey(header),
      correlationId: this.requestContext.requireRequestId(),
      reasonCode: body.reasonCode,
    });
    return { interventionId: intervention.id, status: intervention.status };
  }

  @Post('interventions/:interventionId/verification-challenges')
  @UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
  @ApiBearerAuth()
  @RequirePermissions('intervention.resolve')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Request independent step-up or callback verification' })
  async request(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('interventionId', new ParseUUIDPipe()) interventionId: string,
    @Headers('idempotency-key') header: string | undefined,
    @Body() body: CreateVerificationChallengeDto,
  ) {
    const challenge = await this.stepUp.request(principal, {
      interventionId,
      method: body.method,
      idempotencyKey: requireIdempotencyKey(header),
    });
    return {
      challengeId: challenge.id,
      interventionId: challenge.interventionId,
      status: challenge.status,
      method: challenge.method,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  @Post('internal/verifications/:challengeId/result')
  @UseGuards(InternalServiceGuard, ApiRateLimitGuard)
  @ApiSecurity('verifierService')
  @RequireInternalService('swar-verifier')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'X-SWAR-Service', required: true, schema: { enum: ['swar-verifier'] } })
  @ApiOperation({ summary: 'Record an authenticated independent-verifier adapter result' })
  async complete(
    @Param('challengeId', new ParseUUIDPipe()) challengeId: string,
    @Body() body: CompleteVerificationChallengeDto,
  ) {
    const challenge = await this.stepUp.complete({ challengeId, ...body });
    return {
      challengeId: challenge.id,
      status: challenge.status,
      resultCode: challenge.resultCode,
    };
  }

  @Post('interventions/:interventionId/release')
  @UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
  @ApiBearerAuth()
  @RequirePermissions('intervention.resolve')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Release a hold only after a persisted PASSED independent challenge' })
  async release(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('interventionId', new ParseUUIDPipe()) interventionId: string,
    @Headers('idempotency-key') header: string | undefined,
    @Body() body: ReleaseInterventionDto,
  ) {
    const intervention = await this.interventions.releaseAfterIndependentVerification(principal, {
      interventionId,
      verificationChallengeId: body.verificationChallengeId,
      idempotencyKey: requireIdempotencyKey(header),
      correlationId: this.requestContext.requireRequestId(),
    });
    return { interventionId: intervention.id, status: intervention.status };
  }
}
