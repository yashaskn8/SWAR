import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { ParticipantRole } from '../../generated/prisma/client';

export class CreateCallDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  riskPolicyId!: string;

  @ApiProperty({ maxLength: 40 })
  @IsString()
  @MaxLength(40)
  riskPolicyVersion!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  expectedTrustedSpeakerId?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  protectedActionReference?: string;

  @ApiProperty({ minimum: 2, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(20)
  maximumParticipants!: number;
}

export class InviteParticipantDto {
  @ApiProperty({ enum: ['CALLER', 'CUSTOMER', 'OBSERVER'] })
  @IsIn([ParticipantRole.CALLER, ParticipantRole.CUSTOMER, ParticipantRole.OBSERVER])
  role!: Exclude<ParticipantRole, 'ML_SUBSCRIBER'>;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  membershipId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  trustedSpeakerId?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;
}

export class JoinCallDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  participantId!: string;
}
