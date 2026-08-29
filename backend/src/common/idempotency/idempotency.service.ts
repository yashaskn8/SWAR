import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { ConfigurationService } from '../../config/configuration';
import { IdempotencyConflictError } from '../../database/database.errors';

interface PendingEntry<T> {
  state: 'pending';
  fingerprint: string;
  expiresAt: number;
  promise: Promise<T>;
}

interface CompleteEntry<T> {
  state: 'complete';
  fingerprint: string;
  expiresAt: number;
  value: T;
}

type Entry<T> = PendingEntry<T> | CompleteEntry<T>;

export interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
}

const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const sensitiveResponseField =
  /(password|token|secret|authorization|cookie|embedding|audio|waveform|pcm|voiceprint|ciphertext)/iu;

function normalize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('Idempotency payload must not contain cycles.');
    seen.add(value);
    const normalized = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item, seen)]),
    );
    seen.delete(value);
    return normalized;
  }
  throw new Error('Idempotency payload contains an unsupported value.');
}

export function fingerprintPayload(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
}

function assertSafeResponse(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafeResponse(item, seen);
    return;
  }
  if (typeof value !== 'object' || seen.has(value))
    throw new Error('Idempotency response is not safely cacheable.');
  seen.add(value);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveResponseField.test(key))
      throw new Error('Idempotency response contains a sensitive field.');
    assertSafeResponse(item, seen);
  }
  seen.delete(value);
}

@Injectable()
export class IdempotencyService {
  private readonly entries = new Map<string, Entry<unknown>>();

  constructor(private readonly configuration: ConfigurationService) {}

  async execute<T>(
    input: { scope: string; key: string; payload: unknown },
    operation: () => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    if (!keyPattern.test(input.key) || input.scope.length === 0 || input.scope.length > 120) {
      throw new Error('Idempotency scope or key is invalid.');
    }
    this.purgeExpired();
    const mapKey = `${input.scope}:${input.key}`;
    const fingerprint = fingerprintPayload(input.payload);
    const existing = this.entries.get(mapKey) as Entry<T> | undefined;
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError();
      return existing.state === 'complete'
        ? { value: structuredClone(existing.value), replayed: true }
        : { value: structuredClone(await existing.promise), replayed: true };
    }
    if (this.entries.size >= this.configuration.values.idempotency.maximumEntries) {
      throw new ServiceUnavailableException('Idempotency capacity is unavailable.');
    }
    const expiresAt = Date.now() + this.configuration.values.idempotency.ttlSeconds * 1_000;
    const promise = Promise.resolve()
      .then(operation)
      .then((value) => {
        assertSafeResponse(value);
        return structuredClone(value);
      });
    this.entries.set(mapKey, { state: 'pending', fingerprint, expiresAt, promise });
    try {
      const value = await promise;
      const stored = structuredClone(value);
      this.entries.set(mapKey, { state: 'complete', fingerprint, expiresAt, value: stored });
      return { value: structuredClone(stored), replayed: false };
    } catch (error) {
      this.entries.delete(mapKey);
      throw error;
    }
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now && entry.state === 'complete') this.entries.delete(key);
    }
  }
}
