import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorEnvelopeDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ format: 'uuid' })
  requestId!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  details?: Record<string, string | string[]>;
}

export class MutationAcceptedDto {
  @ApiProperty()
  accepted!: boolean;
}
