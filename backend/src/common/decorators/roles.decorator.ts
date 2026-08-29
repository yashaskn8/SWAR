import { SetMetadata } from '@nestjs/common';

import type { OrganizationRole } from '../../generated/prisma/client';

export const REQUIRED_ROLES = 'swar.required-roles';
export const Roles = (...roles: OrganizationRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);
