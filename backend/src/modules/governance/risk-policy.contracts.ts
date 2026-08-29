import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsString, MaxLength } from 'class-validator';

export class PutRiskPolicyDto {
  @ApiProperty({ maxLength: 40 })
  @IsString()
  @MaxLength(40)
  version!: string;

  @ApiProperty({ maxLength: 40, example: '1.0.0' })
  @IsString()
  @MaxLength(40)
  schemaVersion!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  policyDocument!: Record<string, unknown>;

  @ApiProperty({ description: 'Activate this immutable version after creation.' })
  @IsBoolean()
  activate!: boolean;
}
