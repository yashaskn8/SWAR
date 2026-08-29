import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../permissions';

export const REQUIRED_PERMISSIONS = 'swar.required-permissions';
export const RequirePermissions = (...required: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS, required);
