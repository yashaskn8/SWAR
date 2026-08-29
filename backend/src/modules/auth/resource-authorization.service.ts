import { Injectable } from '@nestjs/common';

import { AuthError } from './auth.errors';
import { hasPermission, type Permission } from './permissions';
import type { AuthPrincipal } from './refresh-session.repository';

@Injectable()
export class ResourceAuthorizationService {
  assert(principal: AuthPrincipal, permission: Permission, resourceOrganizationId: string): void {
    if (
      principal.organizationId !== resourceOrganizationId ||
      !hasPermission(principal.roles, permission)
    ) {
      throw new AuthError('FORBIDDEN');
    }
  }
}
