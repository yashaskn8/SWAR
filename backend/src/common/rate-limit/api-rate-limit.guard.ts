import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import type { AuthenticatedRequest } from '../../modules/auth/guards/access-token.guard';
import { ConfigurationService } from '../../config/configuration';
import { ApiError } from '../errors/api-error';
import { API_RATE_LIMIT_CATEGORY, type ApiRateLimitCategory } from './api-rate-limit.decorator';

interface RateBucket {
  count: number;
  resetsAt: number;
}

@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly reflector: Reflector,
    private readonly configuration: ConfigurationService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const category = this.reflector.getAllAndOverride<ApiRateLimitCategory>(
      API_RATE_LIMIT_CATEGORY,
      [context.getHandler(), context.getClass()],
    );
    if (category === undefined) return true;
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    this.purge(now);
    const limit = this.limit(category);
    const windowMs = this.configuration.values.api.rateLimitWindowSeconds * 1_000;
    const subject = request.principal?.membershipId ?? request.ip ?? 'unauthenticated';
    const key = `${category}:${subject}:${request.method}:${request.path}`;
    const current = this.buckets.get(key);
    const bucket =
      current === undefined || current.resetsAt <= now
        ? { count: 0, resetsAt: now + windowMs }
        : current;
    if (bucket.count >= limit) {
      response.setHeader('retry-after', Math.max(1, Math.ceil((bucket.resetsAt - now) / 1_000)));
      throw new ApiError('RATE_LIMITED', 'Too many requests.', HttpStatus.TOO_MANY_REQUESTS);
    }
    bucket.count += 1;
    this.buckets.set(key, bucket);
    response.setHeader('x-ratelimit-limit', String(limit));
    response.setHeader('x-ratelimit-remaining', String(Math.max(0, limit - bucket.count)));
    response.setHeader('x-ratelimit-reset', new Date(bucket.resetsAt).toISOString());
    return true;
  }

  private limit(category: ApiRateLimitCategory): number {
    const { api } = this.configuration.values;
    if (category === 'SENSITIVE') return api.sensitiveRateLimitMaximum;
    if (category === 'MUTATION') return api.mutationRateLimitMaximum;
    return api.queryRateLimitMaximum;
  }

  private purge(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetsAt <= now) this.buckets.delete(key);
    }
  }
}
