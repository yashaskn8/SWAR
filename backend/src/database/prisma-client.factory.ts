import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';
import { DatabaseConfigurationError } from './database.errors';

const DEFAULT_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

function readBoundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DatabaseConfigurationError(
      `${name} must be an integer between ${minimum.toString()} and ${maximum.toString()}.`,
    );
  }
  return value;
}

export function readDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (value === undefined || value.length === 0) {
    throw new DatabaseConfigurationError('DATABASE_URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DatabaseConfigurationError('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new DatabaseConfigurationError('DATABASE_URL must use PostgreSQL.');
  }
  if (parsed.hostname.length === 0 || parsed.pathname.length <= 1) {
    throw new DatabaseConfigurationError(
      'DATABASE_URL must identify a PostgreSQL host and database.',
    );
  }
  if (process.env.SWAR_ENV === 'production' && parsed.password.length === 0) {
    throw new DatabaseConfigurationError(
      'Production DATABASE_URL must include a non-empty credential.',
    );
  }
  return value;
}

export function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: readDatabaseUrl(),
    max: readBoundedInteger('POSTGRES_POOL_MAX', DEFAULT_POOL_MAX, 1, 100),
    idleTimeoutMillis: readBoundedInteger(
      'POSTGRES_IDLE_TIMEOUT_MS',
      DEFAULT_IDLE_TIMEOUT_MS,
      1_000,
      300_000,
    ),
    connectionTimeoutMillis: readBoundedInteger(
      'POSTGRES_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS,
      100,
      60_000,
    ),
  });

  return new PrismaClient({ adapter });
}
