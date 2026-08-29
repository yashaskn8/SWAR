import { Injectable } from '@nestjs/common';

import { ConfigurationService } from '../../config/configuration';
import { IdempotencyConflictError } from '../../database/database.errors';
import { InterventionPort, type ProtectedActionHold } from './intervention.port';

@Injectable()
export class DemoTransactionHoldAdapter extends InterventionPort {
  readonly adapterKind = 'SWAR_DEMO_TRANSACTION_HOLD' as const;
  private readonly holds = new Map<string, ProtectedActionHold>();

  constructor(configuration: ConfigurationService) {
    super();
    if (configuration.values.runtime.environment === 'production') {
      throw new Error('The SWAR demo transaction-hold adapter is prohibited in production.');
    }
  }

  hold(input: {
    organizationId: string;
    interventionId: string;
    protectedActionReference: string;
    idempotencyKey: string;
  }): Promise<ProtectedActionHold> {
    const key = `${input.organizationId}:${input.idempotencyKey}`;
    const existing = this.holds.get(key);
    if (existing !== undefined) {
      if (
        existing.interventionId !== input.interventionId ||
        existing.protectedActionReference !== input.protectedActionReference
      ) {
        throw new IdempotencyConflictError();
      }
      return Promise.resolve(existing);
    }
    const hold: ProtectedActionHold = {
      adapterKind: this.adapterKind,
      protectedActionReference: input.protectedActionReference,
      interventionId: input.interventionId,
      status: 'HELD',
    };
    this.holds.set(key, hold);
    return Promise.resolve(hold);
  }

  release(input: {
    organizationId: string;
    interventionId: string;
    protectedActionReference: string;
    idempotencyKey: string;
  }): Promise<ProtectedActionHold> {
    const key = `${input.organizationId}:${input.idempotencyKey}`;
    const existing = this.holds.get(key);
    if (existing !== undefined) {
      if (
        existing.interventionId !== input.interventionId ||
        existing.protectedActionReference !== input.protectedActionReference
      ) {
        throw new IdempotencyConflictError();
      }
      return Promise.resolve(existing);
    }
    const released: ProtectedActionHold = {
      adapterKind: this.adapterKind,
      protectedActionReference: input.protectedActionReference,
      interventionId: input.interventionId,
      status: 'RELEASED',
    };
    this.holds.set(key, released);
    return Promise.resolve(released);
  }
}
