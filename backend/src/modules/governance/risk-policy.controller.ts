import { Body, Controller, Get, Headers, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { requireIdempotencyKey } from '../../common/api/request-contracts';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ApiRateLimit } from '../../common/rate-limit/api-rate-limit.decorator';
import { ApiRateLimitGuard } from '../../common/rate-limit/api-rate-limit.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthPrincipal } from '../auth/refresh-session.repository';
import { PutRiskPolicyDto } from './risk-policy.contracts';
import { RiskPolicyService } from './risk-policy.service';

function policyView(policy: {
  id: string;
  policyKey: string;
  version: string;
  schemaVersion: string;
  policyDocument: unknown;
  status: string;
  effectiveAt: Date | null;
}) {
  return {
    riskPolicyId: policy.id,
    policyKey: policy.policyKey,
    version: policy.version,
    schemaVersion: policy.schemaVersion,
    policyDocument: policy.policyDocument,
    status: policy.status,
    effectiveAt: policy.effectiveAt?.toISOString() ?? null,
  };
}

@ApiTags('risk-policy')
@ApiBearerAuth()
@Controller('risk-policies')
@UseGuards(AccessTokenGuard, RolesGuard, ApiRateLimitGuard)
export class RiskPolicyController {
  constructor(
    private readonly policies: RiskPolicyService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('active')
  @RequirePermissions('risk-policy.read')
  @ApiRateLimit('QUERY')
  @ApiOperation({ summary: 'Retrieve the active immutable policy version' })
  async active(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('policyKey') policyKey: string,
  ) {
    return policyView(await this.policies.active(principal, policyKey));
  }

  @Put(':policyKey')
  @RequirePermissions('risk-policy.manage')
  @ApiRateLimit('SENSITIVE')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create and optionally activate an immutable risk-policy version' })
  async put(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('policyKey') policyKey: string,
    @Headers('idempotency-key') header: string | undefined,
    @Body() body: PutRiskPolicyDto,
  ) {
    const key = requireIdempotencyKey(header);
    return (
      await this.idempotency.execute(
        { scope: `${principal.organizationId}:risk-policy`, key, payload: { policyKey, ...body } },
        async () => policyView(await this.policies.put(principal, { policyKey, ...body })),
      )
    ).value;
  }
}
