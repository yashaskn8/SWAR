import { createHash } from 'node:crypto';

import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { requireSingleHeader } from '../../common/api/request-contracts';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { LiveKitPort } from '../../integrations/livekit/livekit.port';
import { TrackBindingService } from './track-binding.service';

@ApiTags('media-webhooks')
@Controller('media/livekit')
export class LiveKitWebhookController {
  constructor(
    private readonly liveKit: LiveKitPort,
    private readonly bindings: TrackBindingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiHeader({ name: 'Authorization', required: true, description: 'LiveKit webhook signature.' })
  @ApiSecurity('liveKitWebhook')
  @ApiConsumes('application/webhook+json', 'application/json')
  @ApiBody({
    description: 'Raw LiveKit lifecycle body. Its signed bytes are verified before field use.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOperation({ summary: 'Verify a signed LiveKit lifecycle webhook before media binding' })
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('authorization') authorization: string | string[] | undefined,
  ): Promise<void> {
    const rawBody = request.rawBody?.toString('utf8');
    if (rawBody === undefined) throw new Error('Verified webhook raw body is unavailable.');
    const verified = await this.liveKit.verifyWebhook(
      rawBody,
      requireSingleHeader(authorization, 'authorization'),
    );
    const replayKey = `lk_${createHash('sha256').update(verified.eventId).digest('hex')}`;
    await this.idempotency.execute(
      {
        scope: 'livekit-webhook',
        key: replayKey,
        payload: {
          eventId: verified.eventId,
          bodyHash: createHash('sha256').update(rawBody).digest('hex'),
        },
      },
      async () => {
        await this.bindings.handleVerifiedLifecycle(verified);
        return { accepted: true };
      },
    );
  }
}
