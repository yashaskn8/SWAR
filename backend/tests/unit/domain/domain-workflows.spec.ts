import { createHash } from 'node:crypto';

import { TokenVerifier, AccessToken } from 'livekit-server-sdk';
import { describe, expect, test, vi } from 'vitest';

import { ConfigurationService } from '../../../src/config/configuration';
import { PersistenceConflictError } from '../../../src/database/database.errors';
import {
  AnalysisSessionStatus,
  AuditOutcome,
  CallStatus,
  ConsentStatus,
  InterventionStatus,
  InterventionType,
  ParticipantRole,
  ParticipantStatus,
  TrackBindingStatus,
  TrackStatus,
  type AnalysisSession,
  type Call,
  type CallParticipant,
  type EnrollmentConsent,
  type MediaTrack,
  type TrackBinding,
} from '../../../src/generated/prisma/client';
import { LiveKitClient } from '../../../src/integrations/livekit/livekit.client';
import type { LiveKitPort } from '../../../src/integrations/livekit/livekit.port';
import type { MlControlPort } from '../../../src/integrations/ml/ml-control.port';
import { AnalysisService } from '../../../src/modules/analysis/analysis.service';
import type { AuditService } from '../../../src/modules/audit/audit.service';
import { AuthError } from '../../../src/modules/auth/auth.errors';
import type { AuthPrincipal } from '../../../src/modules/auth/refresh-session.repository';
import { ResourceAuthorizationService } from '../../../src/modules/auth/resource-authorization.service';
import type { CallRepository } from '../../../src/modules/calls/call.repository';
import { CallsService } from '../../../src/modules/calls/calls.service';
import {
  alertTransitions,
  analysisTransitions,
  assertTransition,
  callTransitions,
  consentTransitions,
  interventionTransitions,
  trackBindingTransitions,
  verificationTransitions,
  voiceprintTransitions,
} from '../../../src/modules/domain/domain-state-machines';
import {
  DomainProviderError,
  IllegalDomainTransitionError,
} from '../../../src/modules/domain/domain.errors';
import type { EnrollmentRepository } from '../../../src/modules/enrollment/enrollment.repository';
import { DemoTransactionHoldAdapter } from '../../../src/modules/interventions/demo-transaction-hold.adapter';
import type { InterventionPort } from '../../../src/modules/interventions/intervention.port';
import { InterventionsService } from '../../../src/modules/interventions/interventions.service';
import { TrackBindingService } from '../../../src/modules/media/track-binding.service';
import type { RiskRepository } from '../../../src/modules/risk/risk.repository';
import type { SecurityEventPort } from '../../../src/modules/security-events/security-event.port';
import { SecurityEventsService } from '../../../src/modules/security-events/security-events.service';
import { EphemeralEnrollmentAudio } from '../../../src/modules/voice-enrollment/ephemeral-audio';
import { VoiceEnrollmentService } from '../../../src/modules/voice-enrollment/voice-enrollment.service';
import { VoiceprintCipherService } from '../../../src/modules/voice-enrollment/voiceprint-cipher.service';
import { validTestEnvironment } from '../../test-environment';

const organizationId = '0192f000-0000-7000-8000-000000000001';
const membershipId = '0192f000-0000-7000-8000-000000000002';
const userId = '0192f000-0000-7000-8000-000000000003';
const deviceId = '0192f000-0000-7000-8000-000000000004';
const sessionId = '0192f000-0000-7000-8000-000000000005';
const callId = '0192f000-0000-7000-8000-000000000006';
const participantId = '0192f000-0000-7000-8000-000000000007';
const bindingId = '0192f000-0000-7000-8000-000000000008';
const analysisSessionId = '0192f000-0000-7000-8000-000000000009';
const mediaTrackId = '0192f000-0000-7000-8000-000000000010';
const consentId = '0192f000-0000-7000-8000-000000000011';
const speakerId = '0192f000-0000-7000-8000-000000000012';
const modelVersionId = '0192f000-0000-7000-8000-000000000013';
const interventionId = '0192f000-0000-7000-8000-000000000014';
const riskEventId = '0192f000-0000-7000-8000-000000000015';

function principal(
  roles: AuthPrincipal['roles'] = ['OWNER'],
  tenant = organizationId,
): AuthPrincipal {
  return { userId, organizationId: tenant, membershipId, deviceId, sessionId, roles };
}

function configuration(): ConfigurationService {
  return new ConfigurationService(validTestEnvironment());
}

function auditDouble(): AuditService {
  return { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
}

function baseCall(status: CallStatus = CallStatus.AUTHORIZED): Call {
  const now = new Date();
  return {
    id: callId,
    organizationId,
    roomName: 'swar-room',
    expectedTrustedSpeakerId: null,
    riskPolicyId: '0192f000-0000-7000-8000-000000000016',
    riskPolicyVersion: 'policy-v1',
    createdByMembershipId: membershipId,
    idempotencyKey: 'call-key',
    protectedActionReference: null,
    status,
    authorizedAt: now,
    startedAt: status === CallStatus.ACTIVE ? now : null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function baseParticipant(role: ParticipantRole = ParticipantRole.CALLER): CallParticipant {
  const now = new Date();
  return {
    id: participantId,
    organizationId,
    callId,
    membershipId,
    trustedSpeakerId: role === ParticipantRole.CALLER ? speakerId : null,
    livekitIdentity: 'server-authorized-caller',
    authorizedIdentity: `membership:${membershipId}`,
    displayName: 'Presentation only',
    role,
    status: ParticipantStatus.AUTHORIZED,
    authorizedAt: now,
    joinedAt: null,
    disconnectedAt: null,
    leftAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function baseSession(
  status: AnalysisSessionStatus = AnalysisSessionStatus.AUTHORIZED,
): AnalysisSession {
  const now = new Date();
  return {
    id: analysisSessionId,
    organizationId,
    callId,
    trackBindingId: bindingId,
    voiceprintId: null,
    idempotencyKey: 'analysis-key',
    bindingRevision: 2,
    status,
    authorizedAt: now,
    startedAt: null,
    stoppedAt: null,
    expiresAt: new Date(now.getTime() + 60_000),
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function baseBinding(): TrackBinding {
  const now = new Date();
  return {
    id: bindingId,
    organizationId,
    callId,
    participantId,
    mediaTrackId,
    revision: 2,
    status: TrackBindingStatus.ACTIVE,
    authorizedAt: now,
    activatedAt: now,
    endedAt: null,
    rejectionCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function baseTrack(): MediaTrack {
  const now = new Date();
  return {
    id: mediaTrackId,
    organizationId,
    callId,
    participantId,
    trackSid: 'TR_verified',
    trackSource: 'MICROPHONE',
    mimeType: 'audio/opus',
    status: TrackStatus.PUBLISHED,
    publishedAt: now,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function verifyMachine<T extends string>(
  name: string,
  transitions: Readonly<Record<T, ReadonlySet<T>>>,
): void {
  const states = Object.keys(transitions) as T[];
  for (const from of states) {
    for (const to of states) {
      if (transitions[from].has(to)) {
        expect(() => assertTransition(name, transitions, from, to)).not.toThrow();
      } else {
        expect(() => assertTransition(name, transitions, from, to)).toThrow(
          IllegalDomainTransitionError,
        );
      }
    }
  }
}

describe('Phase I domain state machines', () => {
  test('accepts every frozen legal transition and rejects every unlisted transition', () => {
    verifyMachine('Call', callTransitions);
    verifyMachine('Consent', consentTransitions);
    verifyMachine('Voiceprint', voiceprintTransitions);
    verifyMachine('TrackBinding', trackBindingTransitions);
    verifyMachine('AnalysisSession', analysisTransitions);
    verifyMachine('Intervention', interventionTransitions);
    verifyMachine('Verification', verificationTransitions);
    verifyMachine('Alert', alertTransitions);
  });
});

describe('LiveKit adapter security', () => {
  test('issues short-lived least-privilege grants and verifies signed lifecycle input', async () => {
    const config = configuration();
    const client = new LiveKitClient(config);
    const caller = await client.issueParticipantGrant({
      roomName: 'room-one',
      participantIdentity: 'server-caller',
      profile: 'CALLER',
      ttlSeconds: 120,
    });
    const ml = await client.issueParticipantGrant({
      roomName: 'room-one',
      participantIdentity: 'server-ml',
      profile: 'ML_SUBSCRIBER',
      ttlSeconds: 120,
    });
    const verifier = new TokenVerifier(
      config.values.secrets.liveKitApiKey,
      config.values.secrets.liveKitApiSecret,
    );
    const callerClaims = await verifier.verify(caller.token);
    const mlClaims = await verifier.verify(ml.token);
    expect(callerClaims.video).toMatchObject({
      room: 'room-one',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    expect(mlClaims.video).toMatchObject({
      room: 'room-one',
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      hidden: true,
    });
    expect(caller.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(120_000);

    const body = JSON.stringify({
      event: 'track_published',
      room: { name: 'room-one' },
      participant: { identity: 'server-caller' },
      track: { sid: 'TR_verified', source: 'MICROPHONE', mimeType: 'audio/opus' },
      id: 'EV_verified',
      createdAt: Math.floor(Date.now() / 1_000).toString(),
    });
    const signature = new AccessToken(
      config.values.secrets.liveKitApiKey,
      config.values.secrets.liveKitApiSecret,
    );
    signature.sha256 = createHash('sha256').update(body).digest('base64');
    const verified = await client.verifyWebhook(body, await signature.toJwt());
    expect(verified).toMatchObject({
      verification: 'LIVEKIT_SIGNATURE_VERIFIED',
      eventType: 'track_published',
      roomName: 'room-one',
      participantIdentity: 'server-caller',
      trackSid: 'TR_verified',
      trackSource: 'MICROPHONE',
    });
    await expect(client.verifyWebhook(body, 'invalid')).rejects.toBeDefined();
  });
});

describe('call workflow', () => {
  test('uses server-generated identities, rejects unauthorized actors, and compensates room failure', async () => {
    const call = baseCall();
    const createCallWithParticipants = vi.fn().mockResolvedValue(call);
    const transitionCall = vi
      .fn()
      .mockImplementation((_context: unknown, input: { next: CallStatus }) =>
        Promise.resolve({ ...call, status: input.next }),
      );
    const calls = {
      createCallWithParticipants,
      transitionCall,
    } as unknown as CallRepository;
    const createRoom = vi.fn().mockResolvedValue({ roomName: call.roomName, roomSid: 'RM_test' });
    const liveKit = {
      createRoom,
    } as unknown as LiveKitPort;
    const service = new CallsService(
      calls,
      new ResourceAuthorizationService(),
      liveKit,
      configuration(),
      auditDouble(),
    );
    await expect(
      service.create(principal(['MEMBER']), {
        riskPolicyId: call.riskPolicyId,
        riskPolicyVersion: call.riskPolicyVersion,
        idempotencyKey: 'create-one',
        maximumParticipants: 4,
        correlationId: 'corr-one',
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await service.create(principal(['CALL_OPERATOR']), {
      riskPolicyId: call.riskPolicyId,
      riskPolicyVersion: call.riskPolicyVersion,
      idempotencyKey: 'create-one',
      maximumParticipants: 4,
      correlationId: 'corr-one',
    });
    const persistedInput = createCallWithParticipants.mock.calls[0]![1] as {
      roomName: string;
      participants: Array<{ livekitIdentity: string }>;
    };
    expect(persistedInput.roomName).toMatch(/^swar-/u);
    expect(persistedInput.participants[0]!.livekitIdentity).toMatch(/^swar-/u);

    createRoom.mockRejectedValueOnce(new Error('timeout with secret'));
    await expect(
      service.create(principal(['CALL_OPERATOR']), {
        riskPolicyId: call.riskPolicyId,
        riskPolicyVersion: call.riskPolicyVersion,
        idempotencyKey: 'create-two',
        maximumParticipants: 4,
        correlationId: 'corr-two',
      }),
    ).rejects.toMatchObject({
      code: 'DOMAIN_PROVIDER_FAILED',
      recoverableState: CallStatus.FAILED,
    });
    expect(transitionCall).toHaveBeenCalledWith(
      { organizationId },
      expect.objectContaining({ next: CallStatus.FAILED }),
    );
  });
});

describe('analysis and verified track binding', () => {
  test('leaves timed-out starts recoverable and auditable in STARTING', async () => {
    const session = baseSession();
    const transitionAnalysisSession = vi
      .fn()
      .mockImplementation((_context: unknown, input: { next: AnalysisSessionStatus }) =>
        Promise.resolve({ ...session, status: input.next }),
      );
    const calls = {
      findAnalysisGrantContext: vi.fn().mockResolvedValue({
        session,
        call: baseCall(CallStatus.ACTIVE),
        participant: baseParticipant(),
        mediaTrack: baseTrack(),
        binding: baseBinding(),
      }),
      transitionAnalysisSession,
    } as unknown as CallRepository;
    const ml = {
      startAnalysis: vi.fn().mockRejectedValue(new Error('provider secret')),
    } as unknown as MlControlPort;
    const auditRecord = vi.fn().mockResolvedValue({});
    const audit = { record: auditRecord } as unknown as AuditService;
    const service = new AnalysisService(calls, {} as EnrollmentRepository, audit, ml);
    await expect(
      service.start({
        organizationId,
        analysisSessionId,
        correlationId: 'corr-analysis',
        idempotencyKey: 'analysis-start',
      }),
    ).rejects.toMatchObject({ recoverableState: AnalysisSessionStatus.STARTING });
    expect(transitionAnalysisSession).toHaveBeenCalledTimes(1);
    expect(transitionAnalysisSession).toHaveBeenCalledWith(
      { organizationId },
      expect.objectContaining({ next: AnalysisSessionStatus.STARTING }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: AuditOutcome.FAILED,
        reasonCode: 'ML_START_FAILED_OR_TIMED_OUT',
      }),
    );
  });

  test('versions caller-microphone republish, stops the prior session, and never uses display metadata', async () => {
    const call = { ...baseCall(CallStatus.ACTIVE), expectedTrustedSpeakerId: speakerId };
    const participant = baseParticipant();
    const nextSession = baseSession();
    const bindTrackAndCreateAnalysis = vi.fn().mockResolvedValue({
      binding: baseBinding(),
      analysisSession: nextSession,
      mediaTrack: baseTrack(),
      supersededAnalysisSessionIds: ['0192f000-0000-7000-8000-000000000099'],
    });
    const calls = {
      findByVerifiedRoomParticipant: vi.fn().mockResolvedValue({ call, participant }),
      bindTrackAndCreateAnalysis,
    } as unknown as CallRepository;
    const enrollment = {
      findActiveVoiceprint: vi
        .fn()
        .mockResolvedValue({ id: '0192f000-0000-7000-8000-000000000098' }),
    } as unknown as EnrollmentRepository;
    const analysis = {
      start: vi.fn().mockResolvedValue({ ...nextSession, status: AnalysisSessionStatus.ACTIVE }),
    } as unknown as AnalysisService;
    const stopAnalysis = vi.fn().mockResolvedValue(undefined);
    const ml = { stopAnalysis } as unknown as MlControlPort;
    const service = new TrackBindingService(
      calls,
      enrollment,
      analysis,
      configuration(),
      auditDouble(),
      ml,
    );
    const result = await service.handleVerifiedLifecycle({
      verification: 'LIVEKIT_SIGNATURE_VERIFIED',
      eventId: 'EV_republish',
      eventType: 'track_published',
      roomName: call.roomName,
      participantIdentity: participant.livekitIdentity,
      trackSid: 'TR_new',
      trackSource: 'MICROPHONE',
      mimeType: 'audio/opus',
      occurredAt: new Date(),
    });
    expect(result?.status).toBe(AnalysisSessionStatus.ACTIVE);
    expect(stopAnalysis).toHaveBeenCalledWith({
      sessionId: '0192f000-0000-7000-8000-000000000099',
      reasonCode: 'TRACK_SUPERSEDED',
    });
    expect(bindTrackAndCreateAnalysis).toHaveBeenCalledWith(
      { organizationId },
      expect.objectContaining({
        participantId,
        trackSid: 'TR_new',
        trackSource: 'MICROPHONE',
      }),
    );

    await expect(
      service.handleVerifiedLifecycle({
        verification: 'LIVEKIT_SIGNATURE_VERIFIED',
        eventId: 'EV_camera',
        eventType: 'track_published',
        roomName: call.roomName,
        participantIdentity: participant.livekitIdentity,
        trackSid: 'TR_camera',
        trackSource: 'CAMERA',
        occurredAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
  });
});

describe('enrollment privacy and revocation race', () => {
  test('clears transient audio and plaintext embedding when consent changes before commit', async () => {
    const consent = {
      id: consentId,
      trustedSpeakerId: speakerId,
      status: ConsentStatus.GRANTED,
      expiresAt: null,
    } as EnrollmentConsent;
    const embedding = Uint8Array.from([7, 8, 9]);
    const enrollment = {
      findConsent: vi.fn().mockResolvedValue(consent),
      activateVoiceprint: vi
        .fn()
        .mockRejectedValue(new PersistenceConflictError('Consent was revoked concurrently.')),
    } as unknown as EnrollmentRepository;
    const ml = {
      inferEnrollment: vi.fn().mockResolvedValue({
        embedding,
        modelVersionId,
        embeddingFormat: 'ecapa-test-format',
        acceptedSampleCount: 2,
      }),
      cancelEnrollment: vi.fn().mockResolvedValue(undefined),
    } as unknown as MlControlPort;
    const audio = new EphemeralEnrollmentAudio([Uint8Array.from([1, 2]), Uint8Array.from([3, 4])]);
    const auditRecord = vi.fn().mockResolvedValue({});
    const audit = { record: auditRecord } as unknown as AuditService;
    const service = new VoiceEnrollmentService(
      enrollment,
      new ResourceAuthorizationService(),
      new VoiceprintCipherService(configuration()),
      audit,
      ml,
    );
    await expect(
      service.enroll(principal(['ENROLLMENT_OPERATOR']), {
        enrollmentOperationId: 'enrollment-operation',
        trustedSpeakerId: speakerId,
        consentId,
        expectedModelVersionId: modelVersionId,
        audio,
        idempotencyKey: 'enrollment-key',
        correlationId: 'corr-enrollment',
      }),
    ).rejects.toBeInstanceOf(PersistenceConflictError);
    expect(audio.cleared).toBe(true);
    expect([...embedding]).toEqual([0, 0, 0]);
    expect(JSON.stringify(auditRecord.mock.calls)).not.toContain('1,2');
  });

  test('tenant authorization is enforced before enrollment data reaches ML', async () => {
    const inferEnrollment = vi.fn();
    const ml = { inferEnrollment } as unknown as MlControlPort;
    const service = new VoiceEnrollmentService(
      {} as EnrollmentRepository,
      new ResourceAuthorizationService(),
      new VoiceprintCipherService(configuration()),
      auditDouble(),
      ml,
    );
    const audio = new EphemeralEnrollmentAudio([Uint8Array.from([1])]);
    await expect(
      service.enroll(principal(['MEMBER']), {
        enrollmentOperationId: 'denied',
        trustedSpeakerId: speakerId,
        consentId,
        expectedModelVersionId: modelVersionId,
        audio,
        idempotencyKey: 'denied',
        correlationId: 'denied',
      }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(inferEnrollment).not.toHaveBeenCalled();
    audio.clear();
  });
});

describe('security events and intervention adapter', () => {
  test('creates stable retry IDs and propagates no model score fields', async () => {
    const publisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as SecurityEventPort;
    const service = new SecurityEventsService(auditDouble(), publisher);
    const input = {
      organizationId,
      callId,
      targetId: riskEventId,
      eventType: 'risk.state.changed' as const,
      schemaVersion: 'v1',
      idempotencyKey: 'event-key',
      correlationId: 'corr-event',
      occurredAt: new Date(),
      metadata: { state: 'UNVERIFIED', reasonCode: 'IDENTITY_NOT_ESTABLISHED' },
    };
    const first = await service.createAndPublish(input);
    const second = await service.createAndPublish(input);
    expect(first.eventId).toBe(second.eventId);
    expect(first).not.toHaveProperty('score');
    expect(first).not.toHaveProperty('threshold');
  });

  test('demo hold is labelled, idempotent, replaceable through its port, and blocked in production', async () => {
    const demo: InterventionPort = new DemoTransactionHoldAdapter(configuration());
    const first = await demo.hold({
      organizationId,
      interventionId,
      protectedActionReference: 'fictional-action-001',
      idempotencyKey: 'hold-key',
    });
    const replay = await demo.hold({
      organizationId,
      interventionId,
      protectedActionReference: 'fictional-action-001',
      idempotencyKey: 'hold-key',
    });
    expect(first).toEqual(replay);
    expect(first.adapterKind).toBe('SWAR_DEMO_TRANSACTION_HOLD');
    expect(
      () =>
        new DemoTransactionHoldAdapter({
          values: { runtime: { environment: 'production' } },
        } as ConfigurationService),
    ).toThrow(/prohibited in production/iu);
  });

  test('intervention authorization and provider timeout preserve the required hold state', async () => {
    const now = new Date();
    const intervention = {
      id: interventionId,
      organizationId,
      callId,
      riskEventId,
      resolvedByMembershipId: null,
      idempotencyKey: 'intervention-key',
      type: InterventionType.HOLD_PROTECTED_ACTION,
      status: InterventionStatus.REQUIRED,
      policyVersion: 'v1',
      reasonCode: 'TEST_ORCHESTRATION',
      protectedActionReference: 'fictional-action-001',
      requiredAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const updateInterventionStatus = vi.fn();
    const risk = {
      findIntervention: vi.fn().mockResolvedValue(intervention),
      updateInterventionStatus,
    } as unknown as RiskRepository;
    const provider = {
      hold: vi.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as InterventionPort;
    const service = new InterventionsService(
      risk,
      new ResourceAuthorizationService(),
      auditDouble(),
      provider,
    );
    await expect(
      service.hold(principal(['CALL_OPERATOR']), {
        interventionId,
        idempotencyKey: 'hold-denied',
        correlationId: 'corr-denied',
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      service.hold(principal(['SECURITY_ANALYST']), {
        interventionId,
        idempotencyKey: 'hold-timeout',
        correlationId: 'corr-timeout',
      }),
    ).rejects.toBeInstanceOf(DomainProviderError);
    expect(updateInterventionStatus).not.toHaveBeenCalled();
  });
});
