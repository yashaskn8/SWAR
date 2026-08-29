export interface MlAnalysisGrant {
  sessionId: string;
  callId: string;
  roomName: string;
  participantIdentity: string;
  trackSid: string;
  bindingId: string;
  bindingRevision: number;
  expiresAt: Date;
  voiceprintId?: string;
}

export interface MlEnrollmentResult {
  embedding: Uint8Array;
  modelVersionId: string;
  embeddingFormat: string;
  acceptedSampleCount: number;
}

export abstract class MlControlPort {
  abstract startAnalysis(grant: MlAnalysisGrant): Promise<void>;

  abstract stopAnalysis(input: { sessionId: string; reasonCode: string }): Promise<void>;

  abstract inferEnrollment(input: {
    enrollmentOperationId: string;
    consentId: string;
    samples: readonly Uint8Array[];
  }): Promise<MlEnrollmentResult>;

  abstract cancelEnrollment(input: {
    enrollmentOperationId: string;
    reasonCode: string;
  }): Promise<void>;
}
