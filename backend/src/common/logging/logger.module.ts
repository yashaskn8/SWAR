import { Global, Module } from '@nestjs/common';

import { RequestContextService } from './request-context.service';
import { SafeLogger } from './safe-logger.service';

@Global()
@Module({
  providers: [RequestContextService, SafeLogger],
  exports: [RequestContextService, SafeLogger],
})
export class LoggerModule {}
