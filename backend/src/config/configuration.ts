import { Global, Inject, Injectable, Module, Optional } from '@nestjs/common';

import { parseEnvironment, type ApplicationConfiguration } from './env.schema';

export const ENVIRONMENT_SOURCE = Symbol('ENVIRONMENT_SOURCE');

@Injectable()
export class ConfigurationService {
  readonly values: ApplicationConfiguration;

  constructor(@Optional() @Inject(ENVIRONMENT_SOURCE) source: NodeJS.ProcessEnv = process.env) {
    this.values = parseEnvironment(source);
  }
}

@Global()
@Module({
  providers: [{ provide: ENVIRONMENT_SOURCE, useValue: process.env }, ConfigurationService],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
