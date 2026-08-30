export type SecurityEventType =
  'risk.state.changed' | 'intervention.required' | 'call.ended' | 'dashboard.risk-event.created';

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
