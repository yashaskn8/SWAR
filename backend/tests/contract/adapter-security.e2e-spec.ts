import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { setValidTestEnvironment } from '../test-environment';

describe('Phase J adapter authentication', () => {
  let app: INestApplication;
  let endpoint: string;

  beforeAll(async () => {
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
    endpoint = await app.getUrl();
  });

  afterAll(async () => app.close());

  it('rejects a public call mutation without a user access session', async () => {
    await request(endpoint)
      .post('/api/v1/calls')
      .set('content-type', 'application/json')
      .set('idempotency-key', 'fictional-call-0001')
      .send({
        riskPolicyId: '018f0000-0000-7000-8000-000000000001',
        riskPolicyVersion: 'fictional-v1',
        maximumParticipants: 2,
      })
      .expect(401);
  });

  it('rejects an ML callback carrying a user or wrong-service credential', async () => {
    await request(endpoint)
      .post('/api/v1/internal/ml/evidence')
      .set('content-type', 'application/json')
      .set('authorization', 'Bearer user-or-wrong-service-token')
      .set('x-swar-service', 'swar-verifier')
      .set('idempotency-key', '018f0000-0000-7000-8000-000000000001')
      .send({})
      .expect(401);
  });
});
