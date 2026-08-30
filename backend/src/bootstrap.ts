import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import express from 'express';
import { WsAdapter } from '@nestjs/platform-ws';

import { SafeLogger } from './common/logging/safe-logger.service';
import { ConfigurationService } from './config/configuration';

export function configureApplication(app: INestApplication): void {
  const configuration = app.get(ConfigurationService).values;
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useLogger(app.get(SafeLogger));
  app.use(
    express.json({
      limit: configuration.runtime.bodyLimitBytes,
      strict: true,
      type: ['application/json', 'application/*+json'],
      verify: (request, _response, buffer) => {
        (request as typeof request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/ready', method: RequestMethod.ALL },
      { path: 'health/metrics', method: RequestMethod.ALL },
    ],
  });
  app.enableCors({
    origin: configuration.runtime.corsAllowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-request-id',
      'x-swar-service',
    ],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });
}

export async function closeWithDeadline(
  app: Pick<INestApplication, 'close'>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      app.close(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Graceful shutdown deadline exceeded.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function configureHttpServerTimeouts(app: INestApplication, timeoutMs: number): void {
  const server = app.getHttpServer() as {
    requestTimeout?: number;
    headersTimeout?: number;
    keepAliveTimeout?: number;
  };
  server.requestTimeout = timeoutMs;
  server.headersTimeout = Math.min(timeoutMs, 60_000);
  server.keepAliveTimeout = Math.min(5_000, timeoutMs);
}
