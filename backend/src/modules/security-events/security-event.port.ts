export type SecurityEventType =
  'risk.state.changed' | 'intervention.required' | 'call.ended' | 'dashboard.risk-event.created';

export interface SecurityEvent {
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
  };
}

export abstract class SecurityEventPort {
  abstract publish(event: SecurityEvent): Promise<void>;
}
