import type { OrganizationRole } from '../../generated/prisma/client';
import { AuthError } from './auth.errors';

export interface LoginRequest {
  email: string;
  organizationSlug: string;
  devicePublicId: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  principal: {
    userId: string;
    membershipId: string;
    organizationId: string;
    deviceId: string;
    roles: OrganizationRole[];
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthError('AUTHENTICATION_FAILED');
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, name: string, maximum: number): string {
  const field = value[name];
  if (typeof field !== 'string') throw new AuthError('AUTHENTICATION_FAILED');
  const normalized = field.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new AuthError('AUTHENTICATION_FAILED');
  }
  return normalized;
}

function secretField(value: Record<string, unknown>, name: string, maximum: number): string {
  const field = value[name];
  if (typeof field !== 'string' || field.length === 0 || field.length > maximum) {
    throw new AuthError('AUTHENTICATION_FAILED');
  }
  return field;
}

export function parseLoginRequest(value: unknown): LoginRequest {
  const body = record(value);
  if (
    Object.keys(body).some(
      (key) => !['email', 'organizationSlug', 'devicePublicId', 'password'].includes(key),
    )
  ) {
    throw new AuthError('AUTHENTICATION_FAILED');
  }
  return {
    email: stringField(body, 'email', 320).toLowerCase(),
    organizationSlug: stringField(body, 'organizationSlug', 80).toLowerCase(),
    devicePublicId: stringField(body, 'devicePublicId', 128),
    password: secretField(body, 'password', 1_024),
  };
}

export function parseRefreshRequest(value: unknown): RefreshRequest {
  const body = record(value);
  if (Object.keys(body).some((key) => key !== 'refreshToken')) {
    throw new AuthError('TOKEN_INVALID');
  }
  return { refreshToken: stringField(body, 'refreshToken', 512) };
}
