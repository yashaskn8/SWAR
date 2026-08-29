import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { closeWithDeadline, configureApplication, configureHttpServerTimeouts } from './bootstrap';
import { SafeLogger } from './common/logging/safe-logger.service';
import { ConfigurationService } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  configureApplication(app);
  const configuration = app.get(ConfigurationService).values;
  const logger = app.get(SafeLogger);
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.event('log', 'application.shutdown.started', { reason: signal });
    void closeWithDeadline(app, configuration.runtime.shutdownTimeoutMs).catch(() => {
      logger.event('error', 'application.shutdown.failed', { code: 'SHUTDOWN_TIMEOUT' });
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen(configuration.runtime.port, configuration.runtime.host);
  configureHttpServerTimeouts(app, configuration.runtime.inboundRequestTimeoutMs);
  logger.event('log', 'application.started', {
    service: 'swar-backend',
    path: configuration.runtime.publicApiUrl,
  });
}

void bootstrap().catch(() => {
  console.error(
    JSON.stringify({ level: 'fatal', event: 'application.startup.failed', code: 'STARTUP_FAILED' }),
  );
  process.exitCode = 1;
});
