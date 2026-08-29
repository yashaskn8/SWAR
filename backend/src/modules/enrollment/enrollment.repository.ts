import { Injectable } from '@nestjs/common';

import {
  AnalysisSessionStatus,
  ConsentStatus,
  TrustedSpeakerStatus,
  VoiceprintStatus,
  type EnrollmentConsent,
  type TrustedSpeaker,
  type Voiceprint,
} from '../../generated/prisma/client';
import {
  InvalidEncryptedPayloadError,
  TenantResourceNotFoundError,
} from '../../database/database.errors';
import {
  requireTenant,
  requireText,
  requireUuid,
  type TenantContext,
} from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';
import { TransactionService } from '../../database/transaction.service';

export interface EncryptedVoiceprintEnvelope {
  kind: 'encrypted-voiceprint-v1';
  ciphertext: Uint8Array;
  encryptionAlgorithm: string;
  encryptionKeyVersion: string;
  embeddingFormat: string;
  sampleCount: number;
}

export interface ConsentRevocationResult {
  consent: EnrollmentConsent;
  revokedAnalysisSessionIds: string[];
}

export interface VoiceprintDeletionResult {
  voiceprint: Voiceprint;
  revokedAnalysisSessionIds: string[];
}

@Injectable()
export class EnrollmentRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  createTrustedSpeaker(
    context: TenantContext,
    input: { userId?: string; externalReference?: string; label: string },
  ): Promise<TrustedSpeaker> {
    const organizationId = requireTenant(context);
    return this.prisma.client.trustedSpeaker.create({
      data: {
        organizationId,
        userId: input.userId === undefined ? null : requireUuid(input.userId, 'userId'),
        externalReference:
          input.externalReference === undefined
            ? null
            : requireText(input.externalReference, 'externalReference', 128),
        label: requireText(input.label, 'label', 160),
        status: TrustedSpeakerStatus.PENDING_ENROLLMENT,
      },
    });
  }

  async findTrustedSpeaker(
    context: TenantContext,
    trustedSpeakerId: string,
  ): Promise<TrustedSpeaker> {
    const organizationId = requireTenant(context);
    const speaker = await this.prisma.client.trustedSpeaker.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: requireUuid(trustedSpeakerId, 'trustedSpeakerId'),
        },
      },
    });
    if (speaker === null) throw new TenantResourceNotFoundError('Trusted speaker');
    return speaker;
  }

  grantConsent(
    context: TenantContext,
    input: {
      trustedSpeakerId: string;
      grantedByMembershipId: string;
      purposeCode: string;
      noticeVersion: string;
      expiresAt?: Date;
    },
  ): Promise<EnrollmentConsent> {
    const organizationId = requireTenant(context);
    return this.prisma.client.enrollmentConsent.create({
      data: {
        organizationId,
        trustedSpeakerId: requireUuid(input.trustedSpeakerId, 'trustedSpeakerId'),
        grantedByMembershipId: requireUuid(input.grantedByMembershipId, 'grantedByMembershipId'),
        purposeCode: requireText(input.purposeCode, 'purposeCode', 80),
        noticeVersion: requireText(input.noticeVersion, 'noticeVersion', 40),
        status: ConsentStatus.GRANTED,
        grantedAt: new Date(),
        expiresAt: input.expiresAt ?? null,
      },
    });
  }

  async findConsent(context: TenantContext, consentId: string): Promise<EnrollmentConsent> {
    const organizationId = requireTenant(context);
    const consent = await this.prisma.client.enrollmentConsent.findUnique({
      where: {
        organizationId_id: { organizationId, id: requireUuid(consentId, 'consentId') },
      },
    });
    if (consent === null) throw new TenantResourceNotFoundError('Enrollment consent');
    return consent;
  }

  async findActiveVoiceprint(
    context: TenantContext,
    trustedSpeakerId: string,
  ): Promise<Voiceprint | null> {
    const organizationId = requireTenant(context);
    return this.prisma.client.voiceprint.findFirst({
      where: {
        organizationId,
        trustedSpeakerId: requireUuid(trustedSpeakerId, 'trustedSpeakerId'),
        status: VoiceprintStatus.ACTIVE,
        ciphertext: { not: null },
      },
      orderBy: { activatedAt: 'desc' },
    });
  }

  revokeConsent(
    context: TenantContext,
    input: { consentId: string; reasonCode: string },
  ): Promise<ConsentRevocationResult> {
    const organizationId = requireTenant(context);
    const consentId = requireUuid(input.consentId, 'consentId');
    const now = new Date();
    return this.transactions.serializable(async (transaction) => {
      const consent = await transaction.enrollmentConsent.findUnique({
        where: { organizationId_id: { organizationId, id: consentId } },
      });
      if (consent === null) throw new TenantResourceNotFoundError('Enrollment consent');
      if (consent.status === ConsentStatus.REVOKED) {
        return { consent, revokedAnalysisSessionIds: [] };
      }
      if (consent.status !== ConsentStatus.GRANTED) {
        throw new TenantResourceNotFoundError('Active enrollment consent');
      }
      const voiceprints = await transaction.voiceprint.findMany({
        where: { organizationId, consentId, status: VoiceprintStatus.ACTIVE },
        select: { id: true },
      });
      await transaction.voiceprint.updateMany({
        where: { id: { in: voiceprints.map(({ id }) => id) } },
        data: { status: VoiceprintStatus.REVOKED, revokedAt: now },
      });
      const sessions = await transaction.analysisSession.findMany({
        where: {
          organizationId,
          voiceprintId: { in: voiceprints.map(({ id }) => id) },
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
        where: { id: { in: sessions.map(({ id }) => id) } },
        data: { status: AnalysisSessionStatus.REVOKED, stoppedAt: now },
      });
      const revoked = await transaction.enrollmentConsent.update({
        where: { organizationId_id: { organizationId, id: consentId } },
        data: {
          status: ConsentStatus.REVOKED,
          revokedAt: now,
          revocationReasonCode: requireText(input.reasonCode, 'reasonCode', 80),
        },
      });
      return {
        consent: revoked,
        revokedAnalysisSessionIds: sessions.map(({ id }) => id),
      };
    });
  }

  deleteVoiceprint(
    context: TenantContext,
    voiceprintId: string,
  ): Promise<VoiceprintDeletionResult> {
    const organizationId = requireTenant(context);
    const id = requireUuid(voiceprintId, 'voiceprintId');
    const now = new Date();
    return this.transactions.serializable(async (transaction) => {
      const voiceprint = await transaction.voiceprint.findUnique({
        where: { organizationId_id: { organizationId, id } },
      });
      if (voiceprint === null) throw new TenantResourceNotFoundError('Voiceprint');
      if (voiceprint.status === VoiceprintStatus.DELETED && voiceprint.ciphertext === null) {
        return { voiceprint, revokedAnalysisSessionIds: [] };
      }
      const sessions = await transaction.analysisSession.findMany({
        where: {
          organizationId,
          voiceprintId: id,
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
        where: { id: { in: sessions.map(({ id }) => id) } },
        data: { status: AnalysisSessionStatus.REVOKED, stoppedAt: now },
      });
      const deleted = await transaction.voiceprint.update({
        where: { organizationId_id: { organizationId, id } },
        data: {
          ciphertext: null,
          status: VoiceprintStatus.DELETED,
          revokedAt: voiceprint.revokedAt ?? now,
          deletedAt: now,
        },
      });
      return {
        voiceprint: deleted,
        revokedAnalysisSessionIds: sessions.map(({ id }) => id),
      };
    });
  }

  activateVoiceprint(
    context: TenantContext,
    input: {
      trustedSpeakerId: string;
      consentId: string;
      modelVersionId: string;
      createdByMembershipId: string;
      envelope: EncryptedVoiceprintEnvelope;
    },
  ): Promise<Voiceprint> {
    const organizationId = requireTenant(context);
    const trustedSpeakerId = requireUuid(input.trustedSpeakerId, 'trustedSpeakerId');
    const consentId = requireUuid(input.consentId, 'consentId');
    requireUuid(input.modelVersionId, 'modelVersionId');
    requireUuid(input.createdByMembershipId, 'createdByMembershipId');
    const { envelope } = input;
    if (
      envelope.kind !== 'encrypted-voiceprint-v1' ||
      envelope.ciphertext.byteLength === 0 ||
      !Number.isInteger(envelope.sampleCount) ||
      envelope.sampleCount <= 0
    ) {
      throw new InvalidEncryptedPayloadError();
    }

    return this.transactions.serializable(async (transaction) => {
      const consent = await transaction.enrollmentConsent.findUnique({
        where: { organizationId_id: { organizationId, id: consentId } },
      });
      if (
        consent === null ||
        consent.trustedSpeakerId !== trustedSpeakerId ||
        consent.status !== ConsentStatus.GRANTED ||
        (consent.expiresAt !== null && consent.expiresAt <= new Date())
      ) {
        throw new TenantResourceNotFoundError('Active enrollment consent');
      }
      await transaction.voiceprint.updateMany({
        where: { organizationId, trustedSpeakerId, status: VoiceprintStatus.ACTIVE },
        data: { status: VoiceprintStatus.REVOKED, revokedAt: new Date() },
      });
      const activatedAt = new Date();
      const voiceprint = await transaction.voiceprint.create({
        data: {
          organizationId,
          trustedSpeakerId,
          consentId,
          modelVersionId: input.modelVersionId,
          createdByMembershipId: input.createdByMembershipId,
          ciphertext: Buffer.from(envelope.ciphertext),
          encryptionAlgorithm: requireText(envelope.encryptionAlgorithm, 'encryptionAlgorithm', 64),
          encryptionKeyVersion: requireText(
            envelope.encryptionKeyVersion,
            'encryptionKeyVersion',
            128,
          ),
          embeddingFormat: requireText(envelope.embeddingFormat, 'embeddingFormat', 64),
          sampleCount: envelope.sampleCount,
          status: VoiceprintStatus.ACTIVE,
          activatedAt,
        },
      });
      await transaction.trustedSpeaker.update({
        where: { organizationId_id: { organizationId, id: trustedSpeakerId } },
        data: { status: TrustedSpeakerStatus.ACTIVE },
      });
      return voiceprint;
    });
  }

  revokeConsentAndDeleteVoiceprint(
    context: TenantContext,
    input: { consentId: string; voiceprintId: string; reasonCode: string },
  ): Promise<Voiceprint> {
    const organizationId = requireTenant(context);
    const consentId = requireUuid(input.consentId, 'consentId');
    const voiceprintId = requireUuid(input.voiceprintId, 'voiceprintId');
    const now = new Date();
    return this.transactions.serializable(async (transaction) => {
      const voiceprint = await transaction.voiceprint.findUnique({
        where: { organizationId_id: { organizationId, id: voiceprintId } },
      });
      if (voiceprint === null || voiceprint.consentId !== consentId) {
        throw new TenantResourceNotFoundError('Voiceprint');
      }
      await transaction.enrollmentConsent.update({
        where: { organizationId_id: { organizationId, id: consentId } },
        data: {
          status: ConsentStatus.REVOKED,
          revokedAt: now,
          revocationReasonCode: requireText(input.reasonCode, 'reasonCode', 80),
        },
      });
      await transaction.analysisSession.updateMany({
        where: {
          organizationId,
          voiceprintId,
          status: {
            in: [
              AnalysisSessionStatus.AUTHORIZED,
              AnalysisSessionStatus.STARTING,
              AnalysisSessionStatus.ACTIVE,
              AnalysisSessionStatus.DEGRADED,
            ],
          },
        },
        data: { status: AnalysisSessionStatus.REVOKED, stoppedAt: now },
      });
      return transaction.voiceprint.update({
        where: { organizationId_id: { organizationId, id: voiceprintId } },
        data: {
          ciphertext: null,
          status: VoiceprintStatus.DELETED,
          revokedAt: voiceprint.revokedAt ?? now,
          deletedAt: now,
        },
      });
    });
  }
}
