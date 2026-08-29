import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ReadinessService, type ReadinessResponse } from './readiness.service';

export interface HealthResponse {
  readonly service: 'swar-backend';
  readonly status: 'ok';
}

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  getLiveness(): HealthResponse {
    return { service: 'swar-backend', status: 'ok' };
  }

  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.readiness.check();
    response.status(result.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
