import { Global, Module } from '@nestjs/common';

import { MlControlClient } from './ml-control.client';
import { MlControlPort } from './ml-control.port';

@Global()
@Module({
  providers: [MlControlClient, { provide: MlControlPort, useExisting: MlControlClient }],
  exports: [MlControlPort],
})
export class MlIntegrationModule {}
