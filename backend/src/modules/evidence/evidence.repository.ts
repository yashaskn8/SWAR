import { Injectable } from '@nestjs/common';

import {
  EvidenceAcceptanceStatus,
  type EvidenceMode,
  Prisma,
  ScoreDirection,
  type EvidenceEvent,
  type EvidenceReadiness,
  type EvidenceType,
} from '../../generated/prisma/client';
import { IdempotencyConflictError } from '../../database/database.errors';
import {
  requireTenant,
  requireText,
  requireUuid,
  type TenantContext,
} from '../../database/database.types';
import { PrismaService } from '../../database/prisma.service';

export interface RecordEvidenceInput {
  callId: string;
  analysisSessionId: string;
  trackBindingId: string;
  modelVersionId?: string;
  supersedesEvidenceId?: string;
  idempotencyKey: string;
  schemaVersion: string;
  evidenceMode: EvidenceMode;
  eventSequence: bigint;
  windowSequence: bigint;
  revision: number;
  evidenceType: EvidenceType;
  readiness: EvidenceReadiness;
  acceptanceStatus?: EvidenceAcceptanceStatus;
  windowStartMs: bigint;
  windowEndMs: bigint;
  observedAt: Date;
  processingLatencyMs?: number;
  speechDurationMs?: number;
  qualityScore?: number | string;
  reasonCodes?: string[];
  modelName?: string;
  modelVersion?: string;
  checkpointHashSha256?: string;
  scoreName?: string;
  scoreDirection?: ScoreDirection;
  rawScore?: number | string;
  calibratedScore?: number | string;
  calibrationVersion?: string;
  errorCode?: string;
}

function isEquivalent(existing: EvidenceEvent, input: RecordEvidenceInput): boolean {
  const decimal = (value: Prisma.Decimal | number | string | null | undefined): string | null =>
    value === undefined || value === null
      ? null
      : typeof value === 'object'
        ? value.toString()
        : String(value);
  return (
    existing.callId === input.callId &&
    existing.analysisSessionId === input.analysisSessionId &&
    existing.trackBindingId === input.trackBindingId &&
    existing.eventSequence === input.eventSequence &&
    existing.windowSequence === input.windowSequence &&
    existing.revision === input.revision &&
    existing.evidenceType === input.evidenceType &&
    existing.readiness === input.readiness &&
    existing.windowStartMs === input.windowStartMs &&
    existing.windowEndMs === input.windowEndMs &&
    existing.modelVersionId === (input.modelVersionId ?? null) &&
    existing.supersedesEvidenceId === (input.supersedesEvidenceId ?? null) &&
    existing.schemaVersion === input.schemaVersion &&
    existing.evidenceMode === input.evidenceMode &&
    existing.acceptanceStatus === (input.acceptanceStatus ?? EvidenceAcceptanceStatus.ACCEPTED) &&
    existing.observedAt.getTime() === input.observedAt.getTime() &&
    existing.processingLatencyMs === (input.processingLatencyMs ?? null) &&
    existing.speechDurationMs === (input.speechDurationMs ?? null) &&
    decimal(existing.qualityScore) === decimal(input.qualityScore) &&
    JSON.stringify(existing.reasonCodes) === JSON.stringify(input.reasonCodes ?? []) &&
    existing.modelName === (input.modelName ?? null) &&
    existing.modelVersion === (input.modelVersion ?? null) &&
    existing.checkpointHashSha256 === (input.checkpointHashSha256 ?? null) &&
    existing.scoreName === (input.scoreName ?? null) &&
    existing.scoreDirection === (input.scoreDirection ?? ScoreDirection.NOT_APPLICABLE) &&
    decimal(existing.rawScore) === decimal(input.rawScore) &&
    decimal(existing.calibratedScore) === decimal(input.calibratedScore) &&
    existing.calibrationVersion === (input.calibrationVersion ?? null) &&
    existing.errorCode === (input.errorCode ?? null)
  );
}

@Injectable()
export class EvidenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(context: TenantContext, input: RecordEvidenceInput): Promise<EvidenceEvent> {
    const organizationId = requireTenant(context);
    requireUuid(input.callId, 'callId');
    requireUuid(input.analysisSessionId, 'analysisSessionId');
    requireUuid(input.trackBindingId, 'trackBindingId');
    if (
      input.eventSequence < 0n ||
      input.windowSequence < 0n ||
      input.revision < 0 ||
      input.windowStartMs < 0n ||
      input.windowEndMs < input.windowStartMs
    ) {
      throw new IdempotencyConflictError();
    }
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey', 128);
    const existing = await this.prisma.client.evidenceEvent.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
    });
    if (existing !== null) {
      if (!isEquivalent(existing, input)) {
        throw new IdempotencyConflictError();
      }
      return existing;
    }

    try {
      return await this.prisma.client.evidenceEvent.create({
        data: {
          organizationId,
          callId: input.callId,
          analysisSessionId: input.analysisSessionId,
          trackBindingId: input.trackBindingId,
          modelVersionId:
            input.modelVersionId === undefined
              ? null
              : requireUuid(input.modelVersionId, 'modelVersionId'),
          supersedesEvidenceId:
            input.supersedesEvidenceId === undefined
              ? null
              : requireUuid(input.supersedesEvidenceId, 'supersedesEvidenceId'),
          idempotencyKey,
          schemaVersion: requireText(input.schemaVersion, 'schemaVersion', 40),
          evidenceMode: input.evidenceMode,
          eventSequence: input.eventSequence,
          windowSequence: input.windowSequence,
          revision: input.revision,
          evidenceType: input.evidenceType,
          readiness: input.readiness,
          acceptanceStatus: input.acceptanceStatus ?? EvidenceAcceptanceStatus.ACCEPTED,
          windowStartMs: input.windowStartMs,
          windowEndMs: input.windowEndMs,
          observedAt: input.observedAt,
          processingLatencyMs: input.processingLatencyMs ?? null,
          speechDurationMs: input.speechDurationMs ?? null,
          qualityScore: input.qualityScore ?? null,
          reasonCodes: input.reasonCodes ?? [],
          modelName: input.modelName ?? null,
          modelVersion: input.modelVersion ?? null,
          checkpointHashSha256: input.checkpointHashSha256 ?? null,
          scoreName: input.scoreName ?? null,
          scoreDirection: input.scoreDirection ?? ScoreDirection.NOT_APPLICABLE,
          rawScore: input.rawScore ?? null,
          calibratedScore: input.calibratedScore ?? null,
          calibrationVersion: input.calibrationVersion ?? null,
          errorCode: input.errorCode ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.prisma.client.evidenceEvent.findUnique({
          where: {
            organizationId_idempotencyKey: { organizationId, idempotencyKey },
          },
        });
        if (replay !== null && isEquivalent(replay, input)) {
          return replay;
        }
        throw new IdempotencyConflictError();
      }
      throw error;
    }
  }
}
