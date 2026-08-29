import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { parseLoginRequest, parseRefreshRequest, type AuthSessionResponse } from './auth.contracts';
import { AuthService } from './auth.service';
import { RequestContextService } from '../../common/logging/request-context.service';
import { ApiRateLimit } from '../../common/rate-limit/api-rate-limit.decorator';
import { ApiRateLimitGuard } from '../../common/rate-limit/api-rate-limit.guard';

@ApiTags('authentication')
@Controller('auth/sessions')
@UseGuards(ApiRateLimitGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiRateLimit('SENSITIVE')
  @ApiOperation({ summary: 'Create an access and refresh session for an enrolled device' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false, required: ['email', 'organizationSlug', 'devicePublicId', 'password'], properties: { email: { type: 'string', format: 'email' }, organizationSlug: { type: 'string', maxLength: 80 }, devicePublicId: { type: 'string', maxLength: 128 }, password: { type: 'string', format: 'password', writeOnly: true, maxLength: 1024 } } } })
  login(@Body() body: unknown): Promise<AuthSessionResponse> {
    return this.auth.login(parseLoginRequest(body), this.requestContext.getRequestId());
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiRateLimit('SENSITIVE')
  @ApiOperation({ summary: 'Rotate a refresh session and issue fresh tokens' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false, required: ['refreshToken'], properties: { refreshToken: { type: 'string', writeOnly: true, maxLength: 512 } } } })
  refresh(@Body() body: unknown): Promise<AuthSessionResponse> {
    return this.auth.refresh(
      parseRefreshRequest(body).refreshToken,
      this.requestContext.getRequestId(),
    );
  }

  @Post('revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiRateLimit('SENSITIVE')
  @ApiOperation({ summary: 'Revoke a refresh session' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false, required: ['refreshToken'], properties: { refreshToken: { type: 'string', writeOnly: true, maxLength: 512 } } } })
  async revoke(@Body() body: unknown): Promise<void> {
    await this.auth.logout(
      parseRefreshRequest(body).refreshToken,
      this.requestContext.getRequestId(),
    );
  }
}
