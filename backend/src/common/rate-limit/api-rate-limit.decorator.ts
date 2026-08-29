import { SetMetadata } from '@nestjs/common';

export const API_RATE_LIMIT_CATEGORY = 'swar.api-rate-limit-category';
export type ApiRateLimitCategory = 'SENSITIVE' | 'MUTATION' | 'QUERY';

export const ApiRateLimit = (category: ApiRateLimitCategory): MethodDecorator & ClassDecorator =>
  SetMetadata(API_RATE_LIMIT_CATEGORY, category);
