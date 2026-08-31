import {
  BadRequestException,
  Body,
  Controller,
  Get,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Response as SupertestResponse } from 'supertest';
import { IsString, Length } from 'class-validator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../src/app.module';
import { configureApplication } from '../../../src/bootstrap';
import { PrismaService } from '../../../src/database/prisma.service';
import { InvalidPaginationCursorError } from '../../../src/database/database.errors';
import {
  DomainInputError,
  DomainProviderError,
  IllegalDomainTransitionError,
} from '../../../src/modules/domain/domain.errors';
import { DependencyProbeService } from '../../../src/modules/health/dependency-probe.service';
import { setValidTestEnvironment } from '../../test-environment';

class StrictRequest {
  @IsString()
  @Length(2, 20)
  name!: string;
}

@Controller('platform-test')
class PlatformTestController {
  @Post('validated')
  validated(@Body() body: StrictRequest): StrictRequest {
    return body;
  }

  @Get('internal-error')
  internalError(): never {
    throw new Error('JWT_SECRET=must-not-leak');
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('private resource detail');
  }

  @Get('bad-request')
  badRequest(): never {
    throw new BadRequestException('private input detail');
  }

  @Get('mapped-error/:kind')
  mappedError(@Param('kind') kind: string): never {
    const errors: Record<string, Error> = {
      unauthorized: new UnauthorizedException('private auth detail'),
      forbidden: new ForbiddenException('private role detail'),
      conflict: new ConflictException('private conflict detail'),
      timeout: new GatewayTimeoutException('private timeout detail'),
      unavailable: new ServiceUnavailableException('private dependency detail'),
      rate: new HttpException('private rate detail', HttpStatus.TOO_MANY_REQUESTS),
      pagination: new InvalidPaginationCursorError(),
      domainInput: new DomainInputError('private input detail'),
      transition: new IllegalDomainTransitionError('Call', 'ACTIVE', 'AUTHORIZED'),
      provider: new DomainProviderError('LIVEKIT', 'private-operation', 'private-state'),
    };
    throw errors[kind] ?? new Error('unknown test error');
  }
}

interface ErrorEnvelope {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

function errorBody(response: SupertestResponse): ErrorEnvelope {
  return response.body as ErrorEnvelope;
}

describe('Phase H platform integration', () => {
  let app: INestApplication;
  let endpoint: string;
  const databaseProbe = vi.fn<() => Promise<unknown>>();

  beforeAll(async () => {
    setValidTestEnvironment();
    databaseProbe.mockResolvedValue([{ ready: 1 }]);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [PlatformTestController],
    })
      .overrideProvider(PrismaService)
      .useValue({
        client: { $queryRaw: databaseProbe },
        onModuleInit: () => Promise.resolve(),
        onModuleDestroy: () => Promise.resolve(),
      })
      .overrideProvider(DependencyProbeService)
      .useValue({ probeMl: () => Promise.resolve(true), probeLiveKit: () => Promise.resolve(true) })
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    endpoint = await app.getUrl();
  });

  afterAll(async () => app.close());

  it('keeps liveness healthy while readiness reports a database failure', async () => {
    databaseProbe.mockRejectedValueOnce(new Error('database-password=must-not-leak'));
    await request(endpoint).get('/health').expect(200, { service: 'swar-backend', status: 'ok' });
    const unavailable = await request(endpoint).get('/health/ready').expect(503);
    expect(unavailable.body).toEqual({
      service: 'swar-backend',
      status: 'not_ready',
      checks: {
        database: 'not_ready',
        ml: 'ready',
        livekit: 'ready',
        productionActivation: 'not_ready',
      },
    });
    const blocked = await request(endpoint).get('/health/ready').expect(503);
    expect(blocked.body).toMatchObject({
      status: 'not_ready',
      checks: { productionActivation: 'not_ready' },
    });
  });

  it('rejects unknown DTO fields with the stable request-ID envelope', async () => {
    const response = await request(endpoint)
      .post('/api/v1/platform-test/validated')
      .set('x-request-id', 'phase-h-request-001')
      .send({ name: 'valid', unexpected: true })
      .expect(400);
    expect(errorBody(response)).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'The request is invalid.',
      requestId: 'phase-h-request-001',
    });
    expect(response.headers['x-request-id']).toBe('phase-h-request-001');
  });

  it('maps malformed JSON, unsupported content type, and oversized bodies without details leakage', async () => {
    const malformed = await request(endpoint)
      .post('/api/v1/platform-test/validated')
      .set('content-type', 'application/json')
      .send('{')
      .expect(400);
    expect(errorBody(malformed)).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(errorBody(malformed).requestId).toMatch(/^[0-9a-f-]{36}$/u);

    const unsupported = await request(endpoint)
      .post('/api/v1/platform-test/validated')
      .set('content-type', 'text/plain')
      .send('plain text')
      .expect(415);
    expect(errorBody(unsupported)).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });

    const oversized = await request(endpoint)
      .post('/api/v1/platform-test/validated')
      .send({ name: 'x'.repeat(2_000) })
      .expect(413);
    expect(errorBody(oversized)).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('maps not-found, bad-request, and unhandled errors without exposing causes or stack data', async () => {
    const notFound = await request(endpoint).get('/api/v1/platform-test/not-found').expect(404);
    expect(errorBody(notFound)).toMatchObject({
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    });
    const badRequest = await request(endpoint).get('/api/v1/platform-test/bad-request').expect(400);
    expect(errorBody(badRequest)).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'The request is invalid.',
    });

    const captured = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const internal = await request(endpoint)
      .get('/api/v1/platform-test/internal-error')
      .expect(500);
    expect(errorBody(internal)).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred.',
    });
    expect(JSON.stringify(internal.body)).not.toContain('must-not-leak');
    expect(captured.mock.calls.flat().join(' ')).not.toContain('must-not-leak');
    captured.mockRestore();
  });

  it('maps authentication, authorization, conflict, rate, and dependency failures consistently', async () => {
    const cases = [
      ['unauthorized', 401, 'AUTHENTICATION_FAILED'],
      ['forbidden', 403, 'FORBIDDEN'],
      ['conflict', 409, 'CONFLICT'],
      ['rate', 429, 'RATE_LIMITED'],
      ['timeout', 504, 'DEPENDENCY_TIMEOUT'],
      ['unavailable', 503, 'DEPENDENCY_UNAVAILABLE'],
      ['pagination', 400, 'PAGINATION_CURSOR_INVALID'],
      ['domainInput', 400, 'DOMAIN_INPUT_INVALID'],
      ['transition', 409, 'ILLEGAL_DOMAIN_TRANSITION'],
      ['provider', 503, 'DOMAIN_PROVIDER_FAILED'],
    ] as const;
    for (const [kind, status, code] of cases) {
      const response = await request(endpoint)
        .get(`/api/v1/platform-test/mapped-error/${kind}`)
        .expect(status);
      expect(errorBody(response)).toMatchObject({ code });
      expect(errorBody(response).requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(JSON.stringify(response.body)).not.toContain('private');
    }
  });

  it('uses a restrictive CORS allowlist', async () => {
    const allowed = await request(endpoint)
      .options('/api/v1/platform-test/validated')
      .set('origin', 'http://127.0.0.1:5173')
      .set('access-control-request-method', 'POST')
      .expect(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    const denied = await request(endpoint)
      .options('/api/v1/platform-test/validated')
      .set('origin', 'https://untrusted.example')
      .set('access-control-request-method', 'POST')
      .expect(204);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
