import { Global, Module } from '@nestjs/common';

import { RequestContextService } from './request-context.service';
import { SafeLogger } from './safe-logger.service';
import { OperationalTelemetryService } from './operational-telemetry.service';

@Global()
@Module({
  providers: [RequestContextService, SafeLogger, OperationalTelemetryService],
  exports: [RequestContextService, SafeLogger, OperationalTelemetryService],
})
export class LoggerModule {}
