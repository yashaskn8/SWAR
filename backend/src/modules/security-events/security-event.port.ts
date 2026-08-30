export type SecurityEventType =
  'risk.state.changed' | 'intervention.required' | 'call.ended' | 'dashboard.risk-event.created';

export const securityEventIdPattern = /^evt_[a-f0-9]{64}$/u;

export function isSecurityEventId(value: unknown): value is string {
  return typeof value === 'string' && securityEventIdPattern.test(value);
}

export interface SecurityEvent {
  outboxId?: string;
  eventId: string;
  eventType: SecurityEventType;
  schemaVersion: string;
  organizationId: string;
  callId: string;
  targetId: string;
  occurredAt: Date;
  metadata: {
    state?: string;
    reasonCode?: string;
    policyVersion?: string;
    mode?: 'DEMO' | 'SHADOW' | 'PRODUCTION';
    interventionType?: string;
  };
}

export abstract class SecurityEventPort {
  abstract publish(event: SecurityEvent): Promise<void>;
}
