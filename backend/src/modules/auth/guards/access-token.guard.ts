import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

import { AccessSessionAuthenticator } from '../access-session-authenticator.service';
import { AuthError } from '../auth.errors';
import type { AuthPrincipal } from '../refresh-session.repository';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: AuthPrincipal;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly authenticator: AccessSessionAuthenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const value = Array.isArray(authorization) ? undefined : authorization;
    if (value === undefined || !value.startsWith('Bearer ')) throw new AuthError('TOKEN_INVALID');
    const token = value.slice(7);
    if (token.length === 0 || token.includes(' ')) throw new AuthError('TOKEN_INVALID');
    request.principal = await this.authenticator.authenticate(token);
    return true;
  }
}
