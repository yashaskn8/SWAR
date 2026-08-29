import { Injectable } from '@nestjs/common';

import {
  ModelLifecycleStatus,
  RiskPolicyStatus,
  type ModelCapability,
  type ModelVersion,
  type Prisma,
  type RiskPolicy,
  type ScoreDirection,
} from '../../generated/prisma/client';
import { TenantResourceNotFoundError } from '../../database/database.errors';
import {
  requireTenant,
  requireText,
  requireUuid,
  type TenantContext,
} from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../../database/transaction.service';

export interface RegisterModelVersionInput {
  modelName: string;
  version: string;
  capability: ModelCapability;
  checkpointHashSha256: string;
  checkpointSource: string;
  checkpointLicense: string;
  inputSampleRateHz: number;
  inputChannelCount: number;
  scoreName: string;
  scoreDirection: ScoreDirection;
  calibrationVersion?: string;
  status?: ModelLifecycleStatus;
}

@Injectable()
export class GovernanceRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  registerModelVersion(input: RegisterModelVersionInput): Promise<ModelVersion> {
    if (!/^[0-9a-f]{64}$/iu.test(input.checkpointHashSha256)) {
      throw new TenantResourceNotFoundError('Valid checkpoint hash');
    }
    if (
      !Number.isInteger(input.inputSampleRateHz) ||
      input.inputSampleRateHz <= 0 ||
      !Number.isInteger(input.inputChannelCount) ||
      input.inputChannelCount <= 0
    ) {
      throw new TenantResourceNotFoundError('Valid model input format');
    }
    return this.prisma.client.modelVersion.create({
      data: {
        modelName: requireText(input.modelName, 'modelName', 120),
        version: requireText(input.version, 'version', 80),
        capability: input.capability,
        checkpointHashSha256: input.checkpointHashSha256.toLowerCase(),
        checkpointSource: requireText(input.checkpointSource, 'checkpointSource', 2_000),
        checkpointLicense: requireText(input.checkpointLicense, 'checkpointLicense', 160),
        inputSampleRateHz: input.inputSampleRateHz,
        inputChannelCount: input.inputChannelCount,
        scoreName: requireText(input.scoreName, 'scoreName', 120),
        scoreDirection: input.scoreDirection,
        calibrationVersion:
          input.calibrationVersion === undefined
            ? null
            : requireText(input.calibrationVersion, 'calibrationVersion', 80),
        status: input.status ?? ModelLifecycleStatus.REGISTERED,
      },
    });
  }

  createRiskPolicy(
    context: TenantContext,
    input: {
      policyKey: string;
      version: string;
      schemaVersion: string;
      policyDocument: Prisma.InputJsonValue;
      createdByMembershipId: string;
    },
  ): Promise<RiskPolicy> {
    const organizationId = requireTenant(context);
    return this.prisma.client.riskPolicy.create({
      data: {
        organizationId,
        policyKey: requireText(input.policyKey, 'policyKey', 80),
        version: requireText(input.version, 'version', 40),
        schemaVersion: requireText(input.schemaVersion, 'schemaVersion', 40),
        policyDocument: input.policyDocument,
        createdByMembershipId: requireUuid(input.createdByMembershipId, 'createdByMembershipId'),
      },
    });
  }

  activateRiskPolicy(context: TenantContext, policyId: string): Promise<RiskPolicy> {
    const organizationId = requireTenant(context);
    const id = requireUuid(policyId, 'policyId');
    return this.transactions.serializable(async (transaction) => {
      const target = await transaction.riskPolicy.findUnique({
        where: { organizationId_id: { organizationId, id } },
      });
      if (target === null) {
        throw new TenantResourceNotFoundError('Risk policy');
      }
      await transaction.riskPolicy.updateMany({
        where: {
          organizationId,
          policyKey: target.policyKey,
          status: RiskPolicyStatus.ACTIVE,
          id: { not: id },
        },
        data: { status: RiskPolicyStatus.RETIRED, retiredAt: new Date() },
      });
      return transaction.riskPolicy.update({
        where: { organizationId_id: { organizationId, id } },
        data: {
          status: RiskPolicyStatus.ACTIVE,
          effectiveAt: new Date(),
          retiredAt: null,
        },
      });
    });
  }

  async findActiveRiskPolicy(context: TenantContext, policyKey: string): Promise<RiskPolicy> {
    const organizationId = requireTenant(context);
    const policy = await this.prisma.client.riskPolicy.findFirst({
      where: {
        organizationId,
        policyKey: requireText(policyKey, 'policyKey', 80),
        status: RiskPolicyStatus.ACTIVE,
      },
      orderBy: { effectiveAt: 'desc' },
    });
    if (policy === null) throw new TenantResourceNotFoundError('Active risk policy');
    return policy;
  }
}
