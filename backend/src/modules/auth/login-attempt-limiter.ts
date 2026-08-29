import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { AuthConfiguration } from './auth.configuration';
import { AuthError } from './auth.errors';

interface AttemptWindow {
  count: number;
  resetAt: number;
}

@Injectable()
export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();

  constructor(private readonly configuration: AuthConfiguration) {}

  assertAllowed(identity: string): void {
    const key = this.key(identity);
    const current = this.attempts.get(key);
    if (
      current !== undefined &&
      current.resetAt > Date.now() &&
      current.count >= this.configuration.loginMaximumAttempts
    ) {
      throw new AuthError('AUTH_RATE_LIMITED');
    }
    if (current !== undefined && current.resetAt <= Date.now()) this.attempts.delete(key);
  }

  failed(identity: string): void {
    const key = this.key(identity);
    const now = Date.now();
    const current = this.attempts.get(key);
    this.attempts.set(
      key,
      current === undefined || current.resetAt <= now
        ? { count: 1, resetAt: now + this.configuration.loginWindowSeconds * 1_000 }
        : { ...current, count: current.count + 1 },
    );
    if (this.attempts.size > 10_000) {
      for (const [candidate, window] of this.attempts) {
        if (window.resetAt <= now) this.attempts.delete(candidate);
      }
    }
  }

  succeeded(identity: string): void {
    this.attempts.delete(this.key(identity));
  }

  private key(identity: string): string {
    return createHash('sha256').update(identity.toLowerCase()).digest('hex');
  }
}
