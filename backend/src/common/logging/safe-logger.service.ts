import { Injectable, type LoggerService } from '@nestjs/common';

import { RequestContextService } from './request-context.service';

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';
type SafeScalar = string | number | boolean | null;

const sensitiveKey =
  /(authorization|cookie|password|token|secret|embedding|audio|waveform|pcm|voiceprint|ciphertext)/iu;
const allowedField = new Set([
  'event',
  'code',
  'requestId',
  'method',
  'path',
  'statusCode',
  'durationMs',
  'service',
  'dependency',
  'attempt',
  'operation',
  'reason',
  'context',
  'message',
  'organizationId',
  'callId',
  'analysisSessionId',
  'riskAssessmentId',
  'riskEventId',
  'interventionId',
  'outboxId',
  'mode',
  'state',
  'outcome',
  'queueDepth',
  'latencyMs',
  'attemptCount',
  'deliveryStatus',
  'readinessFailure',
]);

export function redactText(value: string): string {
  return value
    .replace(
      /(authorization|cookie|password|token|secret|embedding|audio|waveform|pcm|voiceprint|ciphertext)\s*[:=]\s*[^\s,;]+/giu,
      '$1=[REDACTED]',
    )
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/giu, '$1[REDACTED]@')
    .slice(0, 2_048);
}

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, SafeScalar> {
  const sanitized: Record<string, SafeScalar> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!allowedField.has(key)) continue;
    if (sensitiveKey.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      sanitized[key] = redactText(value);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

@Injectable()
export class SafeLogger implements LoggerService {
  constructor(private readonly requestContext: RequestContextService) {}

  event(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      event: redactText(event),
      ...(this.requestContext.getRequestId() === undefined
        ? {}
        : { requestId: this.requestContext.getRequestId() }),
      ...sanitizeLogFields(fields),
    };
    const line = JSON.stringify(payload);
    if (level === 'error' || level === 'fatal') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  log(message: unknown, context?: string): void {
    this.fromNest('log', message, context);
  }
  error(message: unknown, _stack?: string, context?: string): void {
    this.fromNest('error', message, context);
  }
  warn(message: unknown, context?: string): void {
    this.fromNest('warn', message, context);
  }
  debug(message: unknown, context?: string): void {
    this.fromNest('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.fromNest('verbose', message, context);
  }
  fatal(message: unknown, context?: string): void {
    this.fromNest('fatal', message, context);
  }

  private fromNest(level: LogLevel, message: unknown, context?: string): void {
    this.event(level, 'application.log', {
      message: typeof message === 'string' ? message : 'Structured application event',
      ...(context === undefined ? {} : { context }),
    });
  }
}
