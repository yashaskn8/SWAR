import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRED_ROLES } from '../../../common/decorators/roles.decorator';
import type { OrganizationRole } from '../../../generated/prisma/client';
import { REQUIRED_PERMISSIONS } from '../decorators/require-permissions.decorator';
import { AuthError } from '../auth.errors';
import { hasPermission, type Permission } from '../permissions';
import type { AuthenticatedRequest } from './access-token.guard';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const requiredRoles =
      this.reflector.getAllAndOverride<OrganizationRole[]>(REQUIRED_ROLES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    const hasRequiredRole =
      requiredRoles.length === 0 || requiredRoles.some((role) => principal?.roles.includes(role));
    if (
      principal === undefined ||
      !hasRequiredRole ||
      required.some((permission) => !hasPermission(principal.roles, permission))
    ) {
      throw new AuthError('FORBIDDEN');
    }
    return true;
  }
}
