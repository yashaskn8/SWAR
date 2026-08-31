import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { ApiRateLimitModule } from './common/rate-limit/api-rate-limit.module';
import { LoggerModule } from './common/logging/logger.module';
import { RequestContextMiddleware } from './common/logging/request-context.middleware';
import {
  createValidationPipe,
  JsonContentTypeMiddleware,
} from './common/validation/validation.config';
import { ConfigurationModule } from './config/configuration';
import { PrismaModule } from './database/prisma.module';
import { MlIntegrationModule } from './integrations/ml/ml-integration.module';
import { AuthModule } from './modules/auth/auth.module';
import { CallsModule } from './modules/calls/calls.module';
import { HealthModule } from './modules/health/health.module';
import { InterventionsModule } from './modules/interventions/interventions.module';
import { MediaModule } from './modules/media/media.module';
import { SecurityEventsModule } from './modules/security-events/security-events.module';
import { TrustedSpeakersModule } from './modules/trusted-speakers/trusted-speakers.module';
import { VoiceEnrollmentModule } from './modules/voice-enrollment/voice-enrollment.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { SecurityOperationsModule } from './modules/security-operations/security-operations.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';

@Module({
  imports: [
    ConfigurationModule,
    LoggerModule,
    PrismaModule,
    MlIntegrationModule,
    IdempotencyModule,
    ApiRateLimitModule,
    AuthModule,
    HealthModule,
    CallsModule,
    TrustedSpeakersModule,
    VoiceEnrollmentModule,
    EvidenceModule,
    GovernanceModule,
    MediaModule,
    InterventionsModule,
    SecurityEventsModule,
    SecurityOperationsModule,
    MaintenanceModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, JsonContentTypeMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
