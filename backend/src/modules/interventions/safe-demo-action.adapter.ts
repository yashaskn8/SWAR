import { Injectable } from '@nestjs/common';

import { ConfigurationService } from '../../config/configuration';
import { IdempotencyConflictError } from '../../database/database.errors';
import type { InterventionType } from '../../generated/prisma/client';
import { EngineeringActionPort, type EngineeringActionReceipt } from './engineering-action.port';

@Injectable()
export class SafeDemoActionAdapter extends EngineeringActionPort {
  private readonly receipts = new Map<string, EngineeringActionReceipt>();

  constructor(configuration: ConfigurationService) {
    super();
    if (configuration.values.runtime.environment === 'production') {
      throw new Error('The SWAR safe demo action adapter is prohibited in production.');
    }
  }

  dispatch(input: {
    organizationId: string;
    callId: string;
    interventionId: string;
    action: InterventionType;
    idempotencyKey: string;
  }): Promise<EngineeringActionReceipt> {
    const key = `${input.organizationId}:${input.idempotencyKey}`;
    const existing = this.receipts.get(key);
    if (existing !== undefined) {
      if (existing.interventionId !== input.interventionId || existing.action !== input.action) {
        throw new IdempotencyConflictError();
      }
      return Promise.resolve(existing);
    }
    const receipt: EngineeringActionReceipt = {
      adapterKind: 'SWAR_SAFE_DEMO_ACTION',
      interventionId: input.interventionId,
      action: input.action,
      status: 'RECORDED',
    };
    this.receipts.set(key, receipt);
    return Promise.resolve(receipt);
  }
}
