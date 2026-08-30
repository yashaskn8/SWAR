import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import SwaggerParser from '@apidevtools/swagger-parser';
import { DiagnosticSeverity, Parser } from '@asyncapi/parser';
import { NestFactory } from '@nestjs/core';
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';
import { createPublicOpenApi } from '../../src/contracts/public-openapi';
import { setValidTestEnvironment } from '../test-environment';

const contracts = resolve(process.cwd(), '..', 'docs', 'contracts');

beforeAll(() => setValidTestEnvironment());

describe('Phase J machine-readable contracts', () => {
  it('validates all OpenAPI documents and their external references', async () => {
    for (const file of [
      'public-rest.openapi.yaml',
      'ml-control.openapi.yaml',
      'ml-evidence.openapi.yaml',
    ]) {
      await expect(SwaggerParser.validate(resolve(contracts, file))).resolves.toBeDefined();
    }
  });

  it('validates the AsyncAPI document without parser errors', async () => {
    const source = await readFile(resolve(contracts, 'security-events.asyncapi.yaml'), 'utf8');
    const result = await new Parser().parse(source, {
      source: resolve(contracts, 'security-events.asyncapi.yaml'),
    });
    const errorSeverity = Number(DiagnosticSeverity.Error);
    const errors = result.diagnostics.filter(({ severity }) => Number(severity) === errorSeverity);
    expect(errors).toEqual([]);
    expect(result.document).toBeDefined();
    for (const message of [
      'security.subscribe',
      'security.ack',
      'security.ready',
      'security.subscribed',
      'security.acknowledged',
      'security.error',
      'versionedSecurityEvent',
    ]) {
      expect(source).toContain(`name: ${message}`);
    }
  });

  it('keeps the checked-in REST snapshot byte-for-structure aligned with controllers', async () => {
    const app = await NestFactory.create(AppModule, {
      logger: false,
      bodyParser: false,
      abortOnError: false,
    });
    configureApplication(app);
    const generated = createPublicOpenApi(app);
    const checkedIn = JSON.parse(
      await readFile(resolve(contracts, 'public-rest.openapi.yaml'), 'utf8'),
    ) as unknown;
    expect(generated).toEqual(checkedIn);
    await app.close();
  });

  it('documents authentication, rate, idempotency, responses, and non-sensitive examples for every REST operation', async () => {
    const checkedIn = JSON.parse(
      await readFile(resolve(contracts, 'public-rest.openapi.yaml'), 'utf8'),
    ) as {
      paths: Record<
        string,
        Record<
          string,
          {
            responses?: unknown;
            examples?: unknown;
            'x-swar-auth-kind'?: unknown;
            'x-swar-rate-limit-category'?: unknown;
            'x-swar-idempotency'?: unknown;
            'x-swar-required-permissions'?: unknown;
            'x-swar-error-codes'?: unknown;
            requestBody?: unknown;
          }
        >
      >;
    };
    for (const pathItem of Object.values(checkedIn.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        expect(operation['x-swar-auth-kind']).toBeTypeOf('string');
        expect(operation['x-swar-rate-limit-category']).toBeTypeOf('string');
        expect(operation['x-swar-idempotency']).toBeTypeOf('string');
        expect(operation['x-swar-error-codes']).toEqual(
          expect.arrayContaining(['VALIDATION_FAILED', 'INTERNAL_ERROR']),
        );
        expect(Array.isArray(operation['x-swar-error-codes'])).toBe(true);
        for (const code of operation['x-swar-error-codes'] as unknown[]) {
          expect(String(code)).toMatch(/^[A-Z][A-Z0-9_]+$/u);
        }
        if (operation['x-swar-auth-kind'] === 'USER_ACCESS_JWT') {
          expect(operation['x-swar-required-permissions']).toEqual(expect.any(Array));
          expect((operation['x-swar-required-permissions'] as unknown[]).length).toBeGreaterThan(0);
          expect(JSON.stringify(operation.requestBody ?? {})).not.toContain('organizationId');
        }
        expect(operation.responses).toBeDefined();
        expect(JSON.stringify(operation.responses)).not.toMatch(
          /audio|embedding|ciphertext|password|service.?secret/iu,
        );
        expect(JSON.stringify(operation.examples ?? {})).not.toMatch(
          /audio|embedding|ciphertext|password|access.?token|refresh.?token|service.?secret/iu,
        );
      }
    }
  });

  it('enforces evidence discriminators and optional calibration semantics', async () => {
    const schema = JSON.parse(
      await readFile(resolve(contracts, 'schemas', 'ml-evidence.v1.json'), 'utf8'),
    ) as object;
    const ajv = new Ajv2020({
      strict: false,
      formats: { uuid: true, 'date-time': true },
    });
    const validate = ajv.compile(schema);
    const common = {
      eventId: '018f0000-0000-7000-8000-000000000001',
      schemaVersion: '1.0.0',
      organizationId: '018f0000-0000-7000-8000-000000000002',
      callId: '018f0000-0000-7000-8000-000000000003',
      analysisSessionId: '018f0000-0000-7000-8000-000000000004',
      trackBindingId: '018f0000-0000-7000-8000-000000000005',
      eventSequence: '1',
      windowSequence: '1',
      revision: 0,
      windowStartMs: '0',
      windowEndMs: '4000',
      observedAt: '2030-01-01T00:00:04Z',
    };
    expect(
      validate({
        ...common,
        eventType: 'FAST',
        evidenceType: 'IDENTITY',
        modelName: 'FICTIONAL_MODEL',
        modelVersion: 'fictional-v0',
        checkpointHashSha256: 'a'.repeat(64),
        scoreName: 'fictional_raw_score',
        scoreDirection: 'HIGHER_MEANS_MORE',
        rawScore: 0,
        processingLatencyMs: 1,
      }),
    ).toBe(true);
    expect(
      validate({
        ...common,
        eventType: 'DEEP',
        evidenceType: 'SPOOF_DEEP',
        modelName: 'FICTIONAL_DEEP_MODEL',
        modelVersion: 'fictional-v0',
        checkpointHashSha256: 'b'.repeat(64),
        scoreName: 'fictional_deep_raw_score',
        scoreDirection: 'HIGHER_MEANS_MORE',
        rawScore: 0,
        processingLatencyMs: 2,
      }),
    ).toBe(true);
    expect(
      validate({
        ...common,
        eventType: 'FAST',
        evidenceType: 'IDENTITY',
        modelName: 'FICTIONAL_MODEL',
        modelVersion: 'fictional-v0',
        checkpointHashSha256: 'a'.repeat(64),
        scoreName: 'fictional_raw_score',
        scoreDirection: 'HIGHER_MEANS_MORE',
        rawScore: 0,
      }),
    ).toBe(false);
    expect(
      validate({
        ...common,
        eventType: 'INSUFFICIENT_EVIDENCE',
        evidenceType: 'INSUFFICIENT_EVIDENCE',
      }),
    ).toBe(false);
    expect(
      validate({
        ...common,
        eventType: 'INSUFFICIENT_EVIDENCE',
        evidenceType: 'INSUFFICIENT_EVIDENCE',
        reasonCodes: ['INADEQUATE_SPEECH'],
        rawScore: 0,
      }),
    ).toBe(false);
  });

  it('does not expose tenant identifiers in outbound security-event payloads', async () => {
    const schema = await readFile(resolve(contracts, 'schemas', 'security-event.v1.json'), 'utf8');
    expect(schema).not.toContain('organizationId');
    expect(schema).not.toContain('SAFE');
  });

  it('validates the explicitly uncalibrated engineering risk-policy fixture', async () => {
    const schema = JSON.parse(
      await readFile(resolve(contracts, 'schemas', 'risk-policy.v1.json'), 'utf8'),
    ) as object;
    const fixture = JSON.parse(
      await readFile(resolve(contracts, 'risk-policy.engineering-fixture.v1.json'), 'utf8'),
    ) as object;
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(fixture)).toBe(true);
    expect(fixture).toMatchObject({
      activationMode: 'ENGINEERING_ONLY',
      thresholdClassification: 'ENGINEERING_FIXTURE_NOT_CALIBRATED',
      calibrationVersion: null,
    });
  });
});
