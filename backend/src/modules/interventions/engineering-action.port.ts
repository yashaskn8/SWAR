import type { InterventionType } from '../../generated/prisma/client';

export interface EngineeringActionReceipt {
  adapterKind: 'SWAR_SAFE_DEMO_ACTION';
  interventionId: string;
  action: InterventionType;
  status: 'RECORDED';
}

export abstract class EngineeringActionPort {
  abstract dispatch(input: {
    organizationId: string;
    callId: string;
    interventionId: string;
    action: InterventionType;
    idempotencyKey: string;
  }): Promise<EngineeringActionReceipt>;
}
