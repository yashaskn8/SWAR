import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { createPublicOpenApi } from '../src/contracts/public-openapi';
import { setValidTestEnvironment } from '../tests/test-environment';

async function generate(): Promise<void> {
  setValidTestEnvironment();
  const app = await NestFactory.create(AppModule, {
    logger: false,
    bodyParser: false,
    abortOnError: false,
  });
  configureApplication(app);
  const document = createPublicOpenApi(app);
  const output = resolve(process.cwd(), '..', 'docs', 'contracts', 'public-rest.openapi.yaml');
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();
}

const keepAlive = setInterval(() => undefined, 1_000);
void generate()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
