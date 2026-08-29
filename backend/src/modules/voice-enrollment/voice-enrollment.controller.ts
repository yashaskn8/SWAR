import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { requireIdempotencyKey } from '../../common/api/request-contracts';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequestContextService } from '../../common/logging/request-context.service';
import { ApiRateLimit } from '../../common/rate-limit/api-rate-limit.decorator';
import { ApiRateLimitGuard } from '../../common/rate-limit/api-rate-limit.guard';
import { ConfigurationService } from '../../config/configuration';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { EphemeralEnrollmentAudio } from './ephemeral-audio';
import { VoiceEnrollmentDto } from './voice-enrollment.contracts';
import { VoiceEnrollmentService } from './voice-enrollment.service';

interface UploadedAudioFile {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function declaredDurations(raw: string, expected: number, maximum: number): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== expected ||
      parsed.some((item) => !Number.isInteger(item) || Number(item) < 250 || Number(item) > maximum)
    ) {
      throw new Error('invalid');
    }
    return parsed as number[];
  } catch {
    throw new BadRequestException('Declared sample durations are invalid.');
  }
}

@ApiTags('voice-enrollment')
@ApiBearerAuth()
@Controller('voice-enrollments')
@UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
export class VoiceEnrollmentController {
  constructor(
    private readonly enrollment: VoiceEnrollmentService,
    private readonly configuration: ConfigurationService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Post()
  @RequirePermissions('enrollment.manage')
  @ApiRateLimit('SENSITIVE')
  @UseInterceptors(FilesInterceptor('samples', 20, { storage: undefined }))
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create an encrypted voiceprint from transient consented samples' })
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'trustedSpeakerId',
        'consentId',
        'expectedModelVersionId',
        'declaredDurationsMs',
        'samples',
      ],
      properties: {
        trustedSpeakerId: { type: 'string', format: 'uuid' },
        consentId: { type: 'string', format: 'uuid' },
        expectedModelVersionId: { type: 'string', format: 'uuid' },
        declaredDurationsMs: { type: 'string' },
        samples: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  async enroll(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Headers('idempotency-key') header: string | undefined,
    @Body() body: VoiceEnrollmentDto,
    @UploadedFiles() files: UploadedAudioFile[] | undefined,
  ) {
    const limits = this.configuration.values.api;
    if (
      files === undefined ||
      files.length === 0 ||
      files.length > limits.enrollmentMaximumSamples ||
      files.some(
        (file) =>
          !file.mimetype.toLowerCase().startsWith('audio/') ||
          file.size > limits.enrollmentMaximumSampleBytes,
      ) ||
      files.reduce((sum, file) => sum + file.size, 0) > limits.enrollmentMaximumTotalBytes
    ) {
      for (const file of files ?? []) file.buffer.fill(0);
      throw new BadRequestException('Enrollment samples do not satisfy the upload contract.');
    }
    declaredDurations(
      body.declaredDurationsMs,
      files.length,
      limits.enrollmentMaximumDeclaredDurationMs,
    );
    const key = requireIdempotencyKey(header);
    const audio = new EphemeralEnrollmentAudio(files.map(({ buffer }) => buffer));
    try {
      const voiceprint = await this.enrollment.enroll(principal, {
        enrollmentOperationId: key,
        trustedSpeakerId: body.trustedSpeakerId,
        consentId: body.consentId,
        expectedModelVersionId: body.expectedModelVersionId,
        audio,
        idempotencyKey: key,
        correlationId: this.requestContext.requireRequestId(),
      });
      return {
        voiceprintId: voiceprint.id,
        trustedSpeakerId: voiceprint.trustedSpeakerId,
        modelVersionId: voiceprint.modelVersionId,
        status: voiceprint.status,
      };
    } finally {
      for (const file of files) file.buffer.fill(0);
    }
  }
}
