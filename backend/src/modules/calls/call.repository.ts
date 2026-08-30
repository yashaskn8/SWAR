import { Injectable } from '@nestjs/common';

import {
  AnalysisSessionStatus,
  CallStatus,
  type EvidenceMode,
  ParticipantStatus,
  TrackBindingStatus,
  TrackStatus,
  type AnalysisSession,
  type Call,
  type CallParticipant,
  type MediaTrack,
  type ParticipantRole,
  type TrackBinding,
} from '../../generated/prisma/client';
import {
  IdempotencyConflictError,
  PersistenceConflictError,
  TenantResourceNotFoundError,
} from '../../database/database.errors';
import {
  decodeTimeCursor,
  encodeTimeCursor,
  pageLimit,
  type PageRequest,
  type PageResult,
} from '../../database/pagination';
import {
  requireTenant,
  requireText,
  requireUuid,
  type TenantContext,
} from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../../database/transaction.service';

export interface CallParticipantInput {
  membershipId?: string;
  trustedSpeakerId?: string;
  livekitIdentity: string;
  authorizedIdentity: string;
  displayName?: string;
  role: ParticipantRole;
}

export interface BindTrackResult {
  binding: TrackBinding;
  analysisSession: AnalysisSession;
  mediaTrack: MediaTrack;
  supersededAnalysisSessionIds: string[];
}

export interface CallAggregate {
  call: Call;
  participants: CallParticipant[];
}

export interface AnalysisGrantContext {
  session: AnalysisSession;
  call: Call;
  participant: CallParticipant;
  mediaTrack: MediaTrack;
  binding: TrackBinding;
}

@Injectable()
export class CallRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  createCallWithParticipants(
    context: TenantContext,
    input: {
      roomName: string;
      expectedTrustedSpeakerId?: string;
      riskPolicyId: string;
      riskPolicyVersion: string;
      createdByMembershipId: string;
      idempotencyKey: string;
      protectedActionReference?: string;
      participants: CallParticipantInput[];
    },
  ): Promise<Call> {
    const organizationId = requireTenant(context);
    if (input.participants.length === 0) {
      throw new TenantResourceNotFoundError('Call participant');
    }
    const identities = input.participants.map((participant) =>
      requireText(participant.livekitIdentity, 'livekitIdentity', 160),
    );
    if (new Set(identities).size !== identities.length) {
      throw new TenantResourceNotFoundError('Unique participant identity');
    }
    return this.transactions.serializable(async (transaction) => {
      const existing = await transaction.call.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing !== null) {
        if (existing.roomName !== input.roomName) {
          throw new TenantResourceNotFoundError('Idempotent call input');
        }
        return existing;
      }
      const policy = await transaction.riskPolicy.findUnique({
        where: {
          organizationId_id: {
            organizationId,
            id: requireUuid(input.riskPolicyId, 'riskPolicyId'),
          },
        },
      });
      if (policy === null || policy.version !== input.riskPolicyVersion) {
        throw new TenantResourceNotFoundError('Versioned risk policy');
      }
      const now = new Date();
      const call = await transaction.call.create({
        data: {
          organizationId,
          roomName: requireText(input.roomName, 'roomName', 160),
          expectedTrustedSpeakerId:
            input.expectedTrustedSpeakerId === undefined
              ? null
              : requireUuid(input.expectedTrustedSpeakerId, 'expectedTrustedSpeakerId'),
          riskPolicyId: policy.id,
          riskPolicyVersion: requireText(input.riskPolicyVersion, 'riskPolicyVersion', 40),
          createdByMembershipId: requireUuid(input.createdByMembershipId, 'createdByMembershipId'),
          idempotencyKey: requireText(input.idempotencyKey, 'idempotencyKey', 128),
          protectedActionReference:
            input.protectedActionReference === undefined
              ? null
              : requireText(input.protectedActionReference, 'protectedActionReference', 160),
          status: CallStatus.AUTHORIZED,
          authorizedAt: now,
        },
      });
      await transaction.callParticipant.createMany({
        data: input.participants.map((participant) => ({
          organizationId,
          callId: call.id,
          membershipId:
            participant.membershipId === undefined
              ? null
              : requireUuid(participant.membershipId, 'membershipId'),
          trustedSpeakerId:
            participant.trustedSpeakerId === undefined
              ? null
              : requireUuid(participant.trustedSpeakerId, 'trustedSpeakerId'),
          livekitIdentity: requireText(participant.livekitIdentity, 'livekitIdentity', 160),
          authorizedIdentity: requireText(
            participant.authorizedIdentity,
            'authorizedIdentity',
            160,
          ),
          displayName:
            participant.displayName === undefined
              ? null
              : requireText(participant.displayName, 'displayName', 160),
          role: participant.role,
          status: ParticipantStatus.AUTHORIZED,
          authorizedAt: now,
        })),
      });
      return call;
    });
  }

  async findTenantCall(context: TenantContext, callId: string): Promise<Call> {
    const organizationId = requireTenant(context);
    const call = await this.prisma.client.call.findUnique({
      where: {
        organizationId_id: { organizationId, id: requireUuid(callId, 'callId') },
      },
    });
    if (call === null) {
      throw new TenantResourceNotFoundError('Call');
    }
    return call;
  }

  async findCallAggregate(context: TenantContext, callId: string): Promise<CallAggregate> {
    const organizationId = requireTenant(context);
    const aggregate = await this.prisma.client.call.findUnique({
      where: { organizationId_id: { organizationId, id: requireUuid(callId, 'callId') } },
      include: { participants: true },
    });
    if (aggregate === null) throw new TenantResourceNotFoundError('Call');
    const { participants, ...call } = aggregate;
    return { call, participants };
  }

  async findByVerifiedRoomParticipant(
    roomName: string,
    participantIdentity: string,
  ): Promise<{ call: Call; participant: CallParticipant }> {
    const matches = await this.prisma.client.call.findMany({
      where: {
        roomName: requireText(roomName, 'roomName', 160),
        participants: {
          some: {
            livekitIdentity: requireText(participantIdentity, 'participantIdentity', 160),
          },
        },
      },
      include: {
        participants: {
          where: { livekitIdentity: participantIdentity },
          take: 2,
        },
      },
      take: 2,
    });
    const match = matches.at(0);
    const participant = match?.participants.at(0);
    if (matches.length !== 1 || match === undefined || participant === undefined) {
      throw new TenantResourceNotFoundError('Authoritative room participant');
    }
    const { participants, ...call } = match;
    return { call, participant: participants[0]! };
  }

  addParticipant(
    context: TenantContext,
    input: { callId: string; participant: CallParticipantInput },
  ): Promise<CallParticipant> {
    const organizationId = requireTenant(context);
    const callId = requireUuid(input.callId, 'callId');
    return this.transactions.serializable(async (transaction) => {
      const call = await transaction.call.findUnique({
        where: { organizationId_id: { organizationId, id: callId } },
      });
      if (
        call === null ||
        !new Set<CallStatus>([CallStatus.REQUESTED, CallStatus.AUTHORIZED]).has(call.status)
      ) {
        throw new PersistenceConflictError(
          'Participants can only be invited before a call is active.',
        );
      }
      const livekitIdentity = requireText(
        input.participant.livekitIdentity,
        'livekitIdentity',
        160,
      );
      const existing = await transaction.callParticipant.findUnique({
        where: {
          organizationId_callId_livekitIdentity: { organizationId, callId, livekitIdentity },
        },
      });
      if (existing !== null) {
        if (
          existing.role !== input.participant.role ||
          existing.authorizedIdentity !== input.participant.authorizedIdentity ||
          existing.membershipId !== (input.participant.membershipId ?? null) ||
          existing.trustedSpeakerId !== (input.participant.trustedSpeakerId ?? null)
        ) {
          throw new IdempotencyConflictError();
        }
        return existing;
      }
      return transaction.callParticipant.create({
        data: {
          organizationId,
          callId,
          membershipId:
            input.participant.membershipId === undefined
              ? null
              : requireUuid(input.participant.membershipId, 'membershipId'),
          trustedSpeakerId:
            input.participant.trustedSpeakerId === undefined
              ? null
              : requireUuid(input.participant.trustedSpeakerId, 'trustedSpeakerId'),
          livekitIdentity,
          authorizedIdentity: requireText(
            input.participant.authorizedIdentity,
            'authorizedIdentity',
            160,
          ),
          displayName:
            input.participant.displayName === undefined
              ? null
              : requireText(input.participant.displayName, 'displayName', 160),
          role: input.participant.role,
          status: ParticipantStatus.AUTHORIZED,
          authorizedAt: new Date(),
        },
      });
    });
  }

  async markParticipantJoined(
    context: TenantContext,
    participantId: string,
    joinedAt: Date,
  ): Promise<CallParticipant> {
    const organizationId = requireTenant(context);
    const id = requireUuid(participantId, 'participantId');
    const updated = await this.prisma.client.callParticipant.updateMany({
      where: { organizationId, id, status: ParticipantStatus.AUTHORIZED },
      data: { status: ParticipantStatus.JOINED, joinedAt },
    });
    if (updated.count === 0) {
      const replay = await this.prisma.client.callParticipant.findUnique({
        where: { organizationId_id: { organizationId, id } },
      });
      if (replay?.status === ParticipantStatus.JOINED) return replay;
      throw new PersistenceConflictError('Participant cannot join from its current state.');
    }
    return this.prisma.client.callParticipant.findUniqueOrThrow({
      where: { organizationId_id: { organizationId, id } },
    });
  }

  async transitionCall(
    context: TenantContext,
    input: { callId: string; expected: CallStatus; next: CallStatus; occurredAt: Date },
  ): Promise<Call> {
    const organizationId = requireTenant(context);
    const id = requireUuid(input.callId, 'callId');
    const result = await this.prisma.client.call.updateMany({
      where: { organizationId, id, status: input.expected },
      data: {
        status: input.next,
        ...(input.next === CallStatus.ACTIVE ? { startedAt: input.occurredAt } : {}),
        ...(new Set<CallStatus>([CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.FAILED]).has(
          input.next,
        )
          ? { endedAt: input.occurredAt }
          : {}),
      },
    });
    if (result.count !== 1) {
      const replay = await this.findTenantCall(context, id);
      if (replay.status === input.next) return replay;
      throw new PersistenceConflictError('Call state changed concurrently.');
    }
    return this.findTenantCall(context, id);
  }

  async listOpenAnalysisSessions(
    context: TenantContext,
    callId: string,
  ): Promise<AnalysisSession[]> {
    const organizationId = requireTenant(context);
    return this.prisma.client.analysisSession.findMany({
      where: {
        organizationId,
        callId: requireUuid(callId, 'callId'),
        status: {
          in: [
            AnalysisSessionStatus.AUTHORIZED,
            AnalysisSessionStatus.STARTING,
            AnalysisSessionStatus.ACTIVE,
            AnalysisSessionStatus.DEGRADED,
            AnalysisSessionStatus.STOPPING,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listActiveCalls(
    context: TenantContext,
    request: PageRequest = {},
  ): Promise<PageResult<Call>> {
    const organizationId = requireTenant(context);
    const limit = pageLimit(request.limit);
    const cursor = decodeTimeCursor(request.cursor);
    const calls = await this.prisma.client.call.findMany({
      where: {
        organizationId,
        status: { in: [CallStatus.AUTHORIZED, CallStatus.ACTIVE, CallStatus.ENDING] },
        ...(cursor === null
          ? {}
          : {
              OR: [
                { createdAt: { lt: cursor.timestamp } },
                { createdAt: cursor.timestamp, id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasNextPage = calls.length > limit;
    const items = hasNextPage ? calls.slice(0, limit) : calls;
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasNextPage && last !== undefined
          ? encodeTimeCursor({ timestamp: last.createdAt, id: last.id })
          : null,
    };
  }

  bindTrackAndCreateAnalysis(
    context: TenantContext,
    input: {
      callId: string;
      participantId: string;
      trackSid: string;
      trackSource: string;
      mimeType?: string;
      analysisIdempotencyKey: string;
      analysisExpiresAt: Date;
      evidenceMode?: EvidenceMode;
      voiceprintId?: string;
    },
  ): Promise<BindTrackResult> {
    const organizationId = requireTenant(context);
    const callId = requireUuid(input.callId, 'callId');
    const participantId = requireUuid(input.participantId, 'participantId');
    if (input.analysisExpiresAt <= new Date()) {
      throw new TenantResourceNotFoundError('Future analysis expiry');
    }
    return this.transactions.serializable(async (transaction) => {
      const participant = await transaction.callParticipant.findUnique({
        where: {
          organizationId_callId_id: { organizationId, callId, id: participantId },
        },
      });
      const call = await transaction.call.findUnique({
        where: { organizationId_id: { organizationId, id: callId } },
      });
      if (
        participant === null ||
        call === null ||
        !new Set<CallStatus>([CallStatus.AUTHORIZED, CallStatus.ACTIVE]).has(call.status)
      ) {
        throw new TenantResourceNotFoundError('Authorized call participant');
      }
      const existingTrack = await transaction.mediaTrack.findUnique({
        where: {
          organizationId_trackSid: {
            organizationId,
            trackSid: requireText(input.trackSid, 'trackSid', 128),
          },
        },
      });
      if (existingTrack !== null) {
        if (existingTrack.callId !== callId || existingTrack.participantId !== participantId) {
          throw new IdempotencyConflictError();
        }
        const existingBinding = await transaction.trackBinding.findUnique({
          where: {
            organizationId_mediaTrackId: { organizationId, mediaTrackId: existingTrack.id },
          },
        });
        const existingSession = await transaction.analysisSession.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId,
              idempotencyKey: requireText(
                input.analysisIdempotencyKey,
                'analysisIdempotencyKey',
                128,
              ),
            },
          },
        });
        if (
          existingBinding === null ||
          existingSession === null ||
          existingSession.trackBindingId !== existingBinding.id
        ) {
          throw new IdempotencyConflictError();
        }
        return {
          binding: existingBinding,
          analysisSession: existingSession,
          mediaTrack: existingTrack,
          supersededAnalysisSessionIds: [],
        };
      }
      const latest = await transaction.trackBinding.aggregate({
        where: { organizationId, callId },
        _max: { revision: true },
      });
      const revision = (latest._max.revision ?? 0) + 1;
      const now = new Date();
      await transaction.trackBinding.updateMany({
        where: { organizationId, callId, status: TrackBindingStatus.ACTIVE },
        data: { status: TrackBindingStatus.SUPERSEDED, endedAt: now },
      });
      const supersededSessions = await transaction.analysisSession.findMany({
        where: {
          organizationId,
          callId,
          status: {
            in: [
              AnalysisSessionStatus.AUTHORIZED,
              AnalysisSessionStatus.STARTING,
              AnalysisSessionStatus.ACTIVE,
              AnalysisSessionStatus.DEGRADED,
            ],
          },
        },
        select: { id: true },
      });
      await transaction.analysisSession.updateMany({
        where: { id: { in: supersededSessions.map(({ id }) => id) } },
        data: { status: AnalysisSessionStatus.REVOKED, stoppedAt: now },
      });
      const mediaTrack = await transaction.mediaTrack.create({
        data: {
          organizationId,
          callId,
          participantId,
          trackSid: requireText(input.trackSid, 'trackSid', 128),
          trackSource: requireText(input.trackSource, 'trackSource', 40),
          mimeType:
            input.mimeType === undefined ? null : requireText(input.mimeType, 'mimeType', 120),
          status: TrackStatus.PUBLISHED,
          publishedAt: now,
        },
      });
      const binding = await transaction.trackBinding.create({
        data: {
          organizationId,
          callId,
          participantId,
          mediaTrackId: mediaTrack.id,
          revision,
          status: TrackBindingStatus.ACTIVE,
          authorizedAt: now,
          activatedAt: now,
        },
      });
      const analysisSession = await transaction.analysisSession.create({
        data: {
          organizationId,
          callId,
          trackBindingId: binding.id,
          voiceprintId:
            input.voiceprintId === undefined
              ? null
              : requireUuid(input.voiceprintId, 'voiceprintId'),
          idempotencyKey: requireText(input.analysisIdempotencyKey, 'analysisIdempotencyKey', 128),
          bindingRevision: revision,
          ...(input.evidenceMode === undefined ? {} : { evidenceMode: input.evidenceMode }),
          status: AnalysisSessionStatus.AUTHORIZED,
          authorizedAt: now,
          expiresAt: input.analysisExpiresAt,
        },
      });
      await transaction.call.update({
        where: { organizationId_id: { organizationId, id: callId } },
        data: { status: CallStatus.ACTIVE, startedAt: call.startedAt ?? now },
      });
      return {
        binding,
        analysisSession,
        mediaTrack,
        supersededAnalysisSessionIds: supersededSessions.map(({ id }) => id),
      };
    });
  }

  async markParticipantEnded(
    context: TenantContext,
    participantId: string,
    occurredAt: Date,
  ): Promise<CallParticipant> {
    const organizationId = requireTenant(context);
    const id = requireUuid(participantId, 'participantId');
    await this.prisma.client.callParticipant.updateMany({
      where: {
        organizationId,
        id,
        status: { in: [ParticipantStatus.AUTHORIZED, ParticipantStatus.JOINED] },
      },
      data: { status: ParticipantStatus.LEFT, leftAt: occurredAt },
    });
    const participant = await this.prisma.client.callParticipant.findUnique({
      where: { organizationId_id: { organizationId, id } },
    });
    if (participant === null) throw new TenantResourceNotFoundError('Call participant');
    return participant;
  }

  closeVerifiedTrack(
    context: TenantContext,
    input: { callId: string; trackSid: string; occurredAt: Date },
  ): Promise<string[]> {
    const organizationId = requireTenant(context);
    const callId = requireUuid(input.callId, 'callId');
    return this.transactions.serializable(async (transaction) => {
      const track = await transaction.mediaTrack.findUnique({
        where: {
          organizationId_trackSid: {
            organizationId,
            trackSid: requireText(input.trackSid, 'trackSid', 128),
          },
        },
      });
      if (track === null || track.callId !== callId) {
        throw new TenantResourceNotFoundError('Media track');
      }
      const binding = await transaction.trackBinding.findUnique({
        where: { organizationId_mediaTrackId: { organizationId, mediaTrackId: track.id } },
      });
      const sessions =
        binding === null
          ? []
          : await transaction.analysisSession.findMany({
              where: {
                organizationId,
                trackBindingId: binding.id,
                status: {
                  in: [
                    AnalysisSessionStatus.AUTHORIZED,
                    AnalysisSessionStatus.STARTING,
                    AnalysisSessionStatus.ACTIVE,
                    AnalysisSessionStatus.DEGRADED,
                    AnalysisSessionStatus.STOPPING,
                  ],
                },
              },
              select: { id: true },
            });
      await transaction.mediaTrack.update({
        where: { organizationId_id: { organizationId, id: track.id } },
        data: { status: TrackStatus.UNPUBLISHED, endedAt: input.occurredAt },
      });
      if (binding !== null && binding.status === TrackBindingStatus.ACTIVE) {
        await transaction.trackBinding.update({
          where: { organizationId_id: { organizationId, id: binding.id } },
          data: {
            status: TrackBindingStatus.REVOKED,
            endedAt: input.occurredAt,
          },
        });
      }
      await transaction.analysisSession.updateMany({
        where: { id: { in: sessions.map(({ id }) => id) } },
        data: { status: AnalysisSessionStatus.REVOKED, stoppedAt: input.occurredAt },
      });
      return sessions.map(({ id }) => id);
    });
  }

  async findAnalysisGrantContext(
    context: TenantContext,
    analysisSessionId: string,
  ): Promise<AnalysisGrantContext> {
    const organizationId = requireTenant(context);
    const aggregate = await this.prisma.client.analysisSession.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: requireUuid(analysisSessionId, 'analysisSessionId'),
        },
      },
      include: {
        call: true,
        trackBinding: { include: { participant: true, mediaTrack: true } },
      },
    });
    if (aggregate === null) throw new TenantResourceNotFoundError('Analysis session');
    const { call, trackBinding, ...session } = aggregate;
    const { participant, mediaTrack, ...binding } = trackBinding;
    return { session, call, participant, mediaTrack, binding };
  }

  async transitionAnalysisSession(
    context: TenantContext,
    input: {
      analysisSessionId: string;
      expected: AnalysisSessionStatus;
      next: AnalysisSessionStatus;
      failureCode?: string;
      occurredAt: Date;
    },
  ): Promise<AnalysisSession> {
    const organizationId = requireTenant(context);
    const id = requireUuid(input.analysisSessionId, 'analysisSessionId');
    const result = await this.prisma.client.analysisSession.updateMany({
      where: { organizationId, id, status: input.expected },
      data: {
        status: input.next,
        ...(input.next === AnalysisSessionStatus.ACTIVE ? { startedAt: input.occurredAt } : {}),
        ...(new Set<AnalysisSessionStatus>([
          AnalysisSessionStatus.STOPPED,
          AnalysisSessionStatus.FAILED,
          AnalysisSessionStatus.EXPIRED,
          AnalysisSessionStatus.REVOKED,
        ]).has(input.next)
          ? { stoppedAt: input.occurredAt }
          : {}),
        ...(input.failureCode === undefined
          ? {}
          : { failureCode: requireText(input.failureCode, 'failureCode', 80) }),
      },
    });
    if (result.count !== 1) {
      const replay = await this.prisma.client.analysisSession.findUnique({
        where: { organizationId_id: { organizationId, id } },
      });
      if (replay?.status === input.next) return replay;
      throw new PersistenceConflictError('Analysis session state changed concurrently.');
    }
    return this.prisma.client.analysisSession.findUniqueOrThrow({
      where: { organizationId_id: { organizationId, id } },
    });
  }

  async endCall(context: TenantContext, callId: string): Promise<Call> {
    const organizationId = requireTenant(context);
    const id = requireUuid(callId, 'callId');
    const now = new Date();
    return this.transactions.serializable(async (transaction) => {
      const updated = await transaction.call.updateMany({
        where: {
          organizationId,
          id,
          status: { in: [CallStatus.AUTHORIZED, CallStatus.ACTIVE, CallStatus.ENDING] },
        },
        data: { status: CallStatus.ENDED, endedAt: now },
      });
      if (updated.count !== 1) {
        throw new TenantResourceNotFoundError('Active call');
      }
      await transaction.trackBinding.updateMany({
        where: { organizationId, callId: id, status: TrackBindingStatus.ACTIVE },
        data: { status: TrackBindingStatus.REVOKED, endedAt: now },
      });
      await transaction.analysisSession.updateMany({
        where: {
          organizationId,
          callId: id,
          status: {
            in: [
              AnalysisSessionStatus.AUTHORIZED,
              AnalysisSessionStatus.STARTING,
              AnalysisSessionStatus.ACTIVE,
              AnalysisSessionStatus.DEGRADED,
              AnalysisSessionStatus.STOPPING,
            ],
          },
        },
        data: { status: AnalysisSessionStatus.STOPPED, stoppedAt: now },
      });
      const call = await transaction.call.findUnique({ where: { id } });
      if (call === null) {
        throw new TenantResourceNotFoundError('Call');
      }
      return call;
    });
  }
}
