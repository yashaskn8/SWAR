import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateTrustedSpeakerDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  label!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  externalReference?: string;
}

export class GrantConsentDto {
  @ApiProperty({ example: 'expected-speaker-verification' })
  @IsString()
  @MaxLength(80)
  purposeCode!: string;

  @ApiProperty({ example: 'notice-v1' })
  @IsString()
  @MaxLength(80)
  noticeVersion!: string;

  @ApiProperty({ enum: [true], description: 'Must be explicitly true.' })
  @IsBoolean()
  consentAffirmed!: true;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class RevokeConsentDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MaxLength(80)
  reasonCode!: string;
}
