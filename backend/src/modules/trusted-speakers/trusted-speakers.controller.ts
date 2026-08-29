import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { requireIdempotencyKey } from '../../common/api/request-contracts';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { RequestContextService } from '../../common/logging/request-context.service';
import { ApiRateLimit } from '../../common/rate-limit/api-rate-limit.decorator';
import { ApiRateLimitGuard } from '../../common/rate-limit/api-rate-limit.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import {
  CreateTrustedSpeakerDto,
  GrantConsentDto,
  RevokeConsentDto,
} from './trusted-speakers.contracts';
import { TrustedSpeakersService } from './trusted-speakers.service';

@ApiTags('trusted-speakers')
@ApiBearerAuth()
@Controller()
@UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
export class TrustedSpeakersController {
  constructor(
    private readonly speakers: TrustedSpeakersService,
    private readonly idempotency: IdempotencyService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Post('trusted-speakers')
  @RequirePermissions('enrollment.manage')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create a tenant-scoped trusted-speaker record' })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Headers('idempotency-key') header: string | undefined,
    @Body() body: CreateTrustedSpeakerDto,
  ) {
    const key = requireIdempotencyKey(header);
    return (
      await this.idempotency.execute(
        { scope: `${principal.organizationId}:trusted-speaker`, key, payload: body },
        async () => {
          const speaker = await this.speakers.create(principal, {
            ...body,
            correlationId: this.requestContext.requireRequestId(),
            idempotencyKey: key,
          });
          return { trustedSpeakerId: speaker.id, status: speaker.status, label: speaker.label };
        },
      )
    ).value;
  }

  @Post('trusted-speakers/:trustedSpeakerId/consents')
  @RequirePermissions('enrollment.manage')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Record explicit enrollment consent' })
  async consent(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('trustedSpeakerId', new ParseUUIDPipe()) trustedSpeakerId: string,
    @Headers('idempotency-key') header: string | undefined,
    @Body() body: GrantConsentDto,
  ) {
    const key = requireIdempotencyKey(header);
    return (
      await this.idempotency.execute(
        {
          scope: `${principal.organizationId}:enrollment-consent`,
          key,
          payload: { trustedSpeakerId, ...body },
        },
        async () => {
          const consent = await this.speakers.grantConsent(principal, {
            trustedSpeakerId,
            purposeCode: body.purposeCode,
            noticeVersion: body.noticeVersion,
            consentAffirmed: body.consentAffirmed,
            ...(body.expiresAt === undefined ? {} : { expiresAt: new Date(body.expiresAt) }),
            correlationId: this.requestContext.requireRequestId(),
          });
          return {
            consentId: consent.id,
            trustedSpeakerId: consent.trustedSpeakerId,
            status: consent.status,
            expiresAt: consent.expiresAt?.toISOString() ?? null,
          };
        },
      )
    ).value;
  }

  @Post('enrollment-consents/:consentId/revoke')
  @RequirePermissions('enrollment.manage')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Revoke consent and dependent active analysis' })
  async revoke(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('consentId', new ParseUUIDPipe()) consentId: string,
    @Headers('idempotency-key') header: string | undefined,
    @Body() body: RevokeConsentDto,
  ) {
    const consent = await this.speakers.revokeConsent(principal, {
      consentId,
      reasonCode: body.reasonCode,
      idempotencyKey: requireIdempotencyKey(header),
      correlationId: this.requestContext.requireRequestId(),
    });
    return { consentId: consent.id, status: consent.status };
  }

  @Delete('voiceprints/:voiceprintId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('voiceprint.delete')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Delete encrypted voiceprint material and revoke dependent analysis' })
  async deleteVoiceprint(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('voiceprintId', new ParseUUIDPipe()) voiceprintId: string,
    @Headers('idempotency-key') header: string | undefined,
  ) {
    const voiceprint = await this.speakers.deleteVoiceprint(principal, {
      voiceprintId,
      idempotencyKey: requireIdempotencyKey(header),
      correlationId: this.requestContext.requireRequestId(),
    });
    return { voiceprintId: voiceprint.id, status: voiceprint.status };
  }
}
