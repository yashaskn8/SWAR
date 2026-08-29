import type { Prisma } from '../generated/prisma/client';

import { DatabaseConfigurationError } from './database.errors';

export interface TenantContext {
  organizationId: string;
}

export type TransactionClient = Prisma.TransactionClient;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function requireUuid(value: string, field: string): string {
  if (!uuidPattern.test(value)) {
    throw new DatabaseConfigurationError(`${field} must be a valid UUID.`);
  }
  return value;
}

export function requireText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new DatabaseConfigurationError(
      `${field} must contain between 1 and ${maximum.toString()} characters.`,
    );
  }
  return normalized;
}

export function requireTenant(context: TenantContext): string {
  return requireUuid(context.organizationId, 'organizationId');
}
