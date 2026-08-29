import { SetMetadata } from '@nestjs/common';

export type InternalServiceName = 'swar-ml' | 'swar-verifier';
export const INTERNAL_SERVICE_NAME = 'swar.internal-service-name';
export const RequireInternalService = (
  name: InternalServiceName,
): MethodDecorator & ClassDecorator => SetMetadata(INTERNAL_SERVICE_NAME, name);
