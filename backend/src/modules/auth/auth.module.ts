import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthConfiguration } from './auth.configuration';
import { AccessSessionAuthenticator } from './access-session-authenticator.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { InternalServiceGuard } from './guards/internal-service.guard';
import { RolesGuard } from './guards/roles.guard';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { InternalServiceAuthenticatorService } from './internal-service-authenticator.service';
import { PasswordService } from './password.service';
import { RefreshSessionRepository } from './refresh-session.repository';
import { ResourceAuthorizationService } from './resource-authorization.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthConfiguration,
    AuthService,
    PasswordService,
    TokenService,
    RefreshSessionRepository,
    LoginAttemptLimiter,
    AccessSessionAuthenticator,
    InternalServiceAuthenticatorService,
    AccessTokenGuard,
    InternalServiceGuard,
    RolesGuard,
    ResourceAuthorizationService,
  ],
  exports: [
    AccessSessionAuthenticator,
    AccessTokenGuard,
    InternalServiceGuard,
    InternalServiceAuthenticatorService,
    RolesGuard,
    ResourceAuthorizationService,
  ],
})
export class AuthModule {}
