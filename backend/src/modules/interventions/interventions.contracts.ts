import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import { VerificationStatus } from '../../generated/prisma/client';

export class CreateVerificationChallengeDto {
  @ApiProperty({ enum: ['CALLBACK', 'OUT_OF_BAND'] })
  @IsIn(['CALLBACK', 'OUT_OF_BAND'])
  @IsString()
  @MaxLength(80)
  method!: string;
}

export class CompleteVerificationChallengeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() organizationId!: string;
  @ApiProperty({ enum: ['PASSED', 'FAILED'] })
  @IsIn([VerificationStatus.PASSED, VerificationStatus.FAILED])
  result!: Extract<VerificationStatus, 'PASSED' | 'FAILED'>;
  @ApiProperty({ maxLength: 80 }) @IsString() @MaxLength(80) resultCode!: string;
}

export class ReleaseInterventionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() verificationChallengeId!: string;
}
