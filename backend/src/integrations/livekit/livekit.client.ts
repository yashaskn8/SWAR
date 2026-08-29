import { HttpStatus, Injectable } from '@nestjs/common';
import { TrackSource } from '@livekit/protocol';
import {
  AccessToken,
  RoomServiceClient,
  WebhookReceiver,
  trackSourceToString,
} from 'livekit-server-sdk';

import { ConfigurationService } from '../../config/configuration';
import { ApiError } from '../../common/errors/api-error';
import { DatabaseConfigurationError } from '../../database/database.errors';
import { requireText } from '../../database/database.types';
import {
  LiveKitPort,
  type LiveKitParticipantGrant,
  type LiveKitParticipantProfile,
  type LiveKitRoomReference,
  type VerifiedLiveKitLifecycleEvent,
} from './livekit.port';

function serviceUrl(websocketUrl: string): string {
  const url = new URL(websocketUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return url.toString().replace(/\/$/u, '');
}

function permissions(profile: LiveKitParticipantProfile): {
  canPublish: boolean;
  canPublishSources?: TrackSource[];
  canSubscribe: boolean;
  hidden?: boolean;
} {
  switch (profile) {
    case 'CALLER':
    case 'CUSTOMER':
      return {
        canPublish: true,
        canPublishSources: [TrackSource.MICROPHONE],
        canSubscribe: true,
      };
    case 'OBSERVER':
      return { canPublish: false, canSubscribe: true };
    case 'ML_SUBSCRIBER':
      return { canPublish: false, canSubscribe: true, hidden: true };
  }
}

@Injectable()
export class LiveKitClient extends LiveKitPort {
  private readonly rooms: RoomServiceClient;
  private readonly webhooks: WebhookReceiver;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(configuration: ConfigurationService) {
    super();
    const { dependencies, secrets } = configuration.values;
    this.apiKey = secrets.liveKitApiKey;
    this.apiSecret = secrets.liveKitApiSecret;
    this.rooms = new RoomServiceClient(
      serviceUrl(dependencies.liveKitUrl),
      this.apiKey,
      this.apiSecret,
      { requestTimeout: dependencies.httpTimeoutMs / 1_000, failover: false },
    );
    this.webhooks = new WebhookReceiver(this.apiKey, this.apiSecret);
  }

  async createRoom(input: {
    roomName: string;
    callId: string;
    maxParticipants: number;
  }): Promise<LiveKitRoomReference> {
    const roomName = requireText(input.roomName, 'roomName', 160);
    if (!Number.isInteger(input.maxParticipants) || input.maxParticipants < 2) {
      throw new DatabaseConfigurationError('maxParticipants must be an integer of at least two.');
    }
    const existing = (await this.rooms.listRooms([roomName])).at(0);
    const room =
      existing ??
      (await this.rooms.createRoom({
        name: roomName,
        maxParticipants: input.maxParticipants,
        metadata: JSON.stringify({ swarCallId: input.callId }),
      }));
    return { roomName: room.name, roomSid: room.sid };
  }

  async issueParticipantGrant(input: {
    roomName: string;
    participantIdentity: string;
    profile: LiveKitParticipantProfile;
    ttlSeconds: number;
  }): Promise<LiveKitParticipantGrant> {
    const roomName = requireText(input.roomName, 'roomName', 160);
    const identity = requireText(input.participantIdentity, 'participantIdentity', 160);
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 30 || input.ttlSeconds > 900) {
      throw new DatabaseConfigurationError(
        'LiveKit participant TTL must be between 30 and 900 seconds.',
      );
    }
    const accessToken = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      ttl: input.ttlSeconds,
    });
    const grant = permissions(input.profile);
    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: grant.canPublish,
      ...(grant.canPublishSources === undefined
        ? {}
        : { canPublishSources: grant.canPublishSources }),
      canSubscribe: grant.canSubscribe,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      ...(grant.hidden === undefined ? {} : { hidden: grant.hidden }),
    });
    return {
      roomName,
      participantIdentity: identity,
      token: await accessToken.toJwt(),
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1_000),
    };
  }

  removeParticipant(roomName: string, participantIdentity: string): Promise<void> {
    return this.rooms.removeParticipant(
      requireText(roomName, 'roomName', 160),
      requireText(participantIdentity, 'participantIdentity', 160),
    );
  }

  closeRoom(roomName: string): Promise<void> {
    return this.rooms.deleteRoom(requireText(roomName, 'roomName', 160));
  }

  async verifyWebhook(
    rawBody: string,
    authorizationHeader: string,
  ): Promise<VerifiedLiveKitLifecycleEvent> {
    const event = await this.webhooks.receive(rawBody, authorizationHeader).catch(() => {
      throw new ApiError(
        'WEBHOOK_AUTHENTICATION_FAILED',
        'Webhook authentication failed.',
        HttpStatus.UNAUTHORIZED,
      );
    });
    if (
      ![
        'participant_joined',
        'participant_left',
        'participant_connection_aborted',
        'track_published',
        'track_unpublished',
        'room_finished',
      ].includes(event.event)
    ) {
      throw new ApiError(
        'WEBHOOK_EVENT_INVALID',
        'The verified webhook event is invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const roomName = event.room?.name;
    if (roomName === undefined || roomName.length === 0 || event.id.length === 0) {
      throw new ApiError(
        'WEBHOOK_EVENT_INVALID',
        'The verified webhook event is invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const trackSource =
      event.track === undefined ? undefined : trackSourceToString(event.track.source).toUpperCase();
    return {
      verification: 'LIVEKIT_SIGNATURE_VERIFIED',
      eventId: event.id,
      eventType: event.event as VerifiedLiveKitLifecycleEvent['eventType'],
      roomName,
      ...(event.participant?.identity === undefined
        ? {}
        : { participantIdentity: event.participant.identity }),
      ...(event.track?.sid === undefined ? {} : { trackSid: event.track.sid }),
      ...(trackSource === undefined ? {} : { trackSource }),
      ...(event.track?.mimeType === undefined ? {} : { mimeType: event.track.mimeType }),
      occurredAt: new Date(Number(event.createdAt) * 1_000),
    };
  }
}
