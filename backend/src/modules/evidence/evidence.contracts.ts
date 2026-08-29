import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { EvidenceType, ScoreDirection } from '../../generated/prisma/client';

export enum MlEvidenceEventType {
  FAST = 'FAST',
  DEEP = 'DEEP',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
  PIPELINE_ERROR = 'PIPELINE_ERROR',
}

export class MlEvidenceDto {
  @ApiProperty({ enum: MlEvidenceEventType })
  @IsEnum(MlEvidenceEventType)
  eventType!: MlEvidenceEventType;

  @ApiProperty({ format: 'uuid' }) @IsUUID() eventId!: string;
  @ApiProperty({ example: '1.0.0' }) @IsString() @MaxLength(40) schemaVersion!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() organizationId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() callId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() analysisSessionId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() trackBindingId!: string;
  @ApiProperty({ pattern: '^\\d+$' }) @Matches(/^\d+$/u) eventSequence!: string;
  @ApiProperty({ pattern: '^\\d+$' }) @Matches(/^\d+$/u) windowSequence!: string;
  @ApiProperty({ minimum: 0 }) @Type(() => Number) @IsInt() @Min(0) revision!: number;
  @ApiProperty({ enum: EvidenceType }) @IsEnum(EvidenceType) evidenceType!: EvidenceType;
  @ApiProperty({ pattern: '^\\d+$' }) @Matches(/^\d+$/u) windowStartMs!: string;
  @ApiProperty({ pattern: '^\\d+$' }) @Matches(/^\d+$/u) windowEndMs!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() observedAt!: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  processingLatencyMs?: number;
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  speechDurationMs?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() qualityScore?: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reasonCodes?: string[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() modelVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) modelName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) modelVersion?: string;
  @ApiPropertyOptional({ pattern: '^[0-9a-f]{64}$' })
  @IsOptional()
  @Matches(/^[0-9a-f]{64}$/u)
  checkpointHashSha256?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) scoreName?: string;
  @ApiPropertyOptional({ enum: ScoreDirection })
  @IsOptional()
  @IsEnum(ScoreDirection)
  scoreDirection?: ScoreDirection;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() rawScore?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() calibratedScore?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) calibrationVersion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) errorCode?: string;
}
