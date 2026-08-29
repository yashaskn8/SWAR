import { Global, Module } from '@nestjs/common';

import { ApiRateLimitGuard } from './api-rate-limit.guard';

@Global()
@Module({ providers: [ApiRateLimitGuard], exports: [ApiRateLimitGuard] })
export class ApiRateLimitModule {}
