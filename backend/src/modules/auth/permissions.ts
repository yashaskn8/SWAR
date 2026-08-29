import type { OrganizationRole } from '../../generated/prisma/client';

export const permissions = [
  'organization.read',
  'organization.manage',
  'membership.manage',
  'device.manage.self',
  'call.create',
  'call.read',
  'call.end',
  'enrollment.manage',
  'voiceprint.delete',
  'risk-event.read',
  'intervention.resolve',
  'risk-policy.read',
  'risk-policy.manage',
  'audit.read',
] as const;
export type Permission = (typeof permissions)[number];

const rolePermissions: Record<OrganizationRole, ReadonlySet<Permission>> = {
  OWNER: new Set(permissions),
  ADMIN: new Set(permissions),
  SECURITY_ANALYST: new Set([
    'organization.read',
    'device.manage.self',
    'call.create',
    'call.read',
    'call.end',
    'risk-event.read',
    'intervention.resolve',
    'risk-policy.read',
    'audit.read',
  ]),
  CALL_OPERATOR: new Set([
    'organization.read',
    'device.manage.self',
    'call.create',
    'call.read',
    'call.end',
    'risk-event.read',
  ]),
  ENROLLMENT_OPERATOR: new Set([
    'organization.read',
    'device.manage.self',
    'call.read',
    'enrollment.manage',
    'voiceprint.delete',
  ]),
  MEMBER: new Set(['organization.read', 'device.manage.self', 'call.read']),
};

export function hasPermission(roles: readonly OrganizationRole[], permission: Permission): boolean {
  return roles.some((role) => rolePermissions[role].has(permission));
}
