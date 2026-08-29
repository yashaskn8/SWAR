export type LiveKitParticipantProfile = 'CALLER' | 'CUSTOMER' | 'OBSERVER' | 'ML_SUBSCRIBER';

export interface LiveKitRoomReference {
  roomName: string;
  roomSid: string;
}

export interface LiveKitParticipantGrant {
  roomName: string;
  participantIdentity: string;
  token: string;
  expiresAt: Date;
}

export interface VerifiedLiveKitLifecycleEvent {
  readonly verification: 'LIVEKIT_SIGNATURE_VERIFIED';
  readonly eventId: string;
  readonly eventType:
    | 'participant_joined'
    | 'participant_left'
    | 'participant_connection_aborted'
    | 'track_published'
    | 'track_unpublished'
    | 'room_finished';
  readonly roomName: string;
  readonly participantIdentity?: string;
  readonly trackSid?: string;
  readonly trackSource?: string;
  readonly mimeType?: string;
  readonly occurredAt: Date;
}

export abstract class LiveKitPort {
  abstract createRoom(input: {
    roomName: string;
    callId: string;
    maxParticipants: number;
  }): Promise<LiveKitRoomReference>;

  abstract issueParticipantGrant(input: {
    roomName: string;
    participantIdentity: string;
    profile: LiveKitParticipantProfile;
    ttlSeconds: number;
  }): Promise<LiveKitParticipantGrant>;

  abstract removeParticipant(roomName: string, participantIdentity: string): Promise<void>;

  abstract closeRoom(roomName: string): Promise<void>;

  abstract verifyWebhook(
    rawBody: string,
    authorizationHeader: string,
  ): Promise<VerifiedLiveKitLifecycleEvent>;
}
