import { Injectable } from '@nestjs/common';

import { AuthError } from './auth.errors';
import { RefreshSessionRepository, type AuthPrincipal } from './refresh-session.repository';
import { TokenService } from './token.service';

@Injectable()
export class AccessSessionAuthenticator {
  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: RefreshSessionRepository,
  ) {}

  async authenticate(token: string): Promise<AuthPrincipal> {
    if (token.length === 0 || token.includes(' ')) throw new AuthError('TOKEN_INVALID');
    const claims = await this.tokens.verifyAccess(token);
    const principal = await this.sessions.findPrincipal(claims);
    if (principal === null) throw new AuthError('TOKEN_INVALID');
    return principal;
  }
}
