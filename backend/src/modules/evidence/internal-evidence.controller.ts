import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { requireIdempotencyKey } from '../../common/api/request-contracts';
import { ApiError } from '../../common/errors/api-error';
import { ApiRateLimit } from '../../common/rate-limit/api-rate-limit.decorator';
import { ApiRateLimitGuard } from '../../common/rate-limit/api-rate-limit.guard';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { RequireInternalService } from '../auth/decorators/internal-service.decorator';
import { MlEvidenceDto } from './evidence.contracts';
import { EvidenceIngestionService } from './evidence-ingestion.service';

@ApiTags('internal-ml')
@ApiSecurity('mlService')
@Controller('internal/ml/evidence')
@UseGuards(InternalServiceGuard, ApiRateLimitGuard)
@RequireInternalService('swar-ml')
export class InternalEvidenceController {
  constructor(private readonly ingestion: EvidenceIngestionService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiRateLimit('MUTATION')
  @ApiHeader({ name: 'X-SWAR-Service', required: true, schema: { enum: ['swar-ml'] } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Accept bound, idempotent ML evidence from the authenticated ML service',
  })
  ingest(@Headers('idempotency-key') header: string | undefined, @Body() body: MlEvidenceDto) {
    const key = requireIdempotencyKey(header);
    if (key !== body.eventId) {
      throw new ApiError(
        'IDEMPOTENCY_EVENT_MISMATCH',
        'Idempotency-Key must equal eventId.',
        HttpStatus.CONFLICT,
      );
    }
    return this.ingestion.ingest(body);
  }
}
