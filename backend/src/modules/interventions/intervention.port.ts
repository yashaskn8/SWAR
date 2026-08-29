export interface ProtectedActionHold {
  adapterKind: 'SWAR_DEMO_TRANSACTION_HOLD';
  protectedActionReference: string;
  interventionId: string;
  status: 'HELD' | 'RELEASED';
}

export abstract class InterventionPort {
  abstract hold(input: {
    organizationId: string;
    interventionId: string;
    protectedActionReference: string;
    idempotencyKey: string;
  }): Promise<ProtectedActionHold>;

  abstract release(input: {
    organizationId: string;
    interventionId: string;
    protectedActionReference: string;
    idempotencyKey: string;
  }): Promise<ProtectedActionHold>;
}
