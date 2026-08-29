import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength } from 'class-validator';

export class VoiceEnrollmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  trustedSpeakerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  consentId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  expectedModelVersionId!: string;

  @ApiProperty({
    description: 'JSON array of per-sample declared durations in milliseconds.',
    example: '[4000,4000,4000]',
  })
  @IsString()
  @MaxLength(512)
  declaredDurationsMs!: string;
}
