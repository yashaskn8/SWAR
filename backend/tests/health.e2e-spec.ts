import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { PrismaService } from '../src/database/prisma.service';
import { setValidTestEnvironment } from './test-environment';

describe('backend liveness', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('serves only the Phase C liveness contract', async () => {
    setValidTestEnvironment();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        client: {},
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => Promise.resolve(),
      })
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const endpoint = await app.getUrl();

    const response = await request(endpoint).get('/health').expect(200);

    expect(response.body).toEqual({
      service: 'swar-backend',
      status: 'ok',
    });
    await request(endpoint).get('/api/v1').expect(404);
  });
});
