import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';

import { closeWithDeadline } from '../../../src/bootstrap';
import {
  IdempotencyService,
  fingerprintPayload,
} from '../../../src/common/idempotency/idempotency.service';
import {
  RequestContextService,
  resolveRequestId,
} from '../../../src/common/logging/request-context.middleware';
import { SafeLogger } from '../../../src/common/logging/safe-logger.service';
import {
  ConfigurationModule,
  ConfigurationService,
  ENVIRONMENT_SOURCE,
} from '../../../src/config/configuration';
import { EnvironmentValidationError, parseEnvironment } from '../../../src/config/env.schema';
import { IdempotencyConflictError } from '../../../src/database/database.errors';
import { validTestEnvironment } from '../../test-environment';

describe('Phase H platform units', () => {
  it('parses a complete typed environment and rejects invalid values without exposing secrets', () => {
    const source = validTestEnvironment();
    const parsed = parseEnvironment(source);
    expect(parsed.runtime.environment).toBe('test');
    expect(parsed.runtime.corsAllowedOrigins).toEqual(['http://127.0.0.1:5173']);
    expect(parsed.auth.accessSecret).toBe(source.JWT_ACCESS_SECRET);

    const invalid = {
      ...source,
      JWT_ACCESS_SECRET: 'private-value',
      CORS_ALLOWED_ORIGINS: '*',
    };
    expect(() => parseEnvironment(invalid)).toThrow(EnvironmentValidationError);
    try {
      parseEnvironment(invalid);
    } catch (error) {
      expect(String(error)).not.toContain('private-value');
      expect(String(error)).toContain('JWT_ACCESS_SECRET');
      expect(String(error)).toContain('CORS_ALLOWED_ORIGINS');
    }
  });

  it('rejects plaintext production endpoints and origins', () => {
    const source = validTestEnvironment({
      SWAR_ENV: 'production',
      PUBLIC_API_URL: 'http://public.example.test/api/v1',
      SECURITY_WS_URL: 'ws://public.example.test/ws/security',
      ML_INTERNAL_URL: 'http://ml.example.test',
      LIVEKIT_URL: 'ws://livekit.example.test',
      CORS_ALLOWED_ORIGINS: 'http://dashboard.example.test',
    });
    expect(() => parseEnvironment(source)).toThrow(
      /CORS_ALLOWED_ORIGINS|LIVEKIT_URL|ML_INTERNAL_URL|PUBLIC_API_URL|SECURITY_WS_URL/u,
    );
  });

  it('rejects simulated and shadow evidence modes in production configuration', () => {
    const production = {
      SWAR_ENV: 'production',
      PUBLIC_API_URL: 'https://api.example.test/api/v1',
      SECURITY_WS_URL: 'wss://api.example.test/ws/security',
      ML_INTERNAL_URL: 'https://ml.example.test',
      LIVEKIT_URL: 'wss://livekit.example.test',
      CORS_ALLOWED_ORIGINS: 'https://dashboard.example.test',
      DATABASE_URL: 'postgresql://swar:password@example.test/swar',
    };
    expect(() =>
      parseEnvironment(validTestEnvironment({ ...production, ML_EVIDENCE_MODE: 'SIMULATED' })),
    ).toThrow(/ML_EVIDENCE_MODE/u);
    expect(() =>
      parseEnvironment(validTestEnvironment({ ...production, ML_EVIDENCE_MODE: 'SHADOW' })),
    ).toThrow(/ML_EVIDENCE_MODE/u);
    expect(() =>
      parseEnvironment(validTestEnvironment({ ...production, ML_EVIDENCE_MODE: 'CALIBRATED' })),
    ).not.toThrow();
  });

  it('fails closed when production intervention mode is requested before O/P/Q promotion', () => {
    expect(() =>
      parseEnvironment(
        validTestEnvironment({
          RISK_INTERVENTION_MODE: 'PRODUCTION',
          PHASE_O_SCIENTIFIC_STATUS: 'BLOCKED',
          PHASE_P_PRODUCTION_STATUS: 'BLOCKED_BY_PHASE_O',
          PHASE_Q_PRODUCTION_STATUS: 'ENGINEERING_ONLY',
        }),
      ),
    ).toThrow(
      /PHASE_O_SCIENTIFIC_STATUS|PHASE_P_PRODUCTION_STATUS|PHASE_Q_PRODUCTION_STATUS|RISK_INTERVENTION_MODE/u,
    );
  });

  it('prevents the backend configuration module from starting with an invalid environment', async () => {
    const invalid = validTestEnvironment({ JWT_ACCESS_SECRET: 'short-private-value' });
    await expect(
      Test.createTestingModule({ imports: [ConfigurationModule] })
        .overrideProvider(ENVIRONMENT_SOURCE)
        .useValue(invalid)
        .compile(),
    ).rejects.toThrow(/JWT_ACCESS_SECRET/u);
  });

  it('produces deterministic fingerprints and coalesces/replays matching idempotency keys', async () => {
    const service = new IdempotencyService(new ConfigurationService(validTestEnvironment()));
    expect(fingerprintPayload({ b: 2, a: 1 })).toBe(fingerprintPayload({ a: 1, b: 2 }));
    let calls = 0;
    const first = service.execute(
      { scope: 'test.operation', key: 'idem-key-0001', payload: { amount: 1 } },
      () => {
        calls += 1;
        return Promise.resolve({ status: 'accepted' });
      },
    );
    const concurrent = service.execute(
      { scope: 'test.operation', key: 'idem-key-0001', payload: { amount: 1 } },
      () => Promise.resolve({ status: 'should-not-run' }),
    );
    await expect(first).resolves.toEqual({ value: { status: 'accepted' }, replayed: false });
    await expect(concurrent).resolves.toEqual({ value: { status: 'accepted' }, replayed: true });
    expect(calls).toBe(1);
    await expect(
      service.execute(
        { scope: 'test.operation', key: 'idem-key-0001', payload: { amount: 2 } },
        () => Promise.resolve({ status: 'different' }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('refuses to cache sensitive responses and permits a clean retry', async () => {
    const service = new IdempotencyService(new ConfigurationService(validTestEnvironment()));
    await expect(
      service.execute({ scope: 'test.operation', key: 'idem-key-0002', payload: {} }, () =>
        Promise.resolve({ accessToken: 'must-not-be-cached' }),
      ),
    ).rejects.toThrow(/sensitive/u);
    await expect(
      service.execute({ scope: 'test.operation', key: 'idem-key-0002', payload: {} }, () =>
        Promise.resolve({ status: 'accepted' }),
      ),
    ).resolves.toMatchObject({ replayed: false });
  });

  it('generates/propagates bounded request IDs and redacts sensitive log text', () => {
    expect(resolveRequestId('request-1234')).toBe('request-1234');
    expect(resolveRequestId('invalid request id')).toMatch(/^[0-9a-f-]{36}$/u);
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const context = new RequestContextService();
    const logger = new SafeLogger(context);
    context.run({ requestId: 'request-1234', method: 'GET', path: '/' }, () => {
      expect(context.outboundHeaders()).toEqual({ 'x-request-id': 'request-1234' });
      logger.event('log', 'security.test', {
        message: 'password=hunter2 authorization=Bearer-private',
        authorization: 'Bearer private',
        unknown: 'not-allowlisted',
      });
    });
    const line = String(output.mock.calls[0]?.[0]);
    expect(line).toContain('request-1234');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('Bearer-private');
    expect(line).not.toContain('not-allowlisted');
    output.mockRestore();
  });

  it('enforces a bounded graceful-shutdown deadline', async () => {
    await expect(
      closeWithDeadline({ close: () => Promise.resolve() }, 50),
    ).resolves.toBeUndefined();
    await expect(
      closeWithDeadline({ close: () => new Promise<void>(() => undefined) }, 10),
    ).rejects.toThrow(/deadline/u);
  });

  it('contains no relative TypeScript import cycle outside generated code', () => {
    const sourceRoot = resolve(__dirname, '../../../src');
    const files: string[] = [];
    const visit = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'generated') visit(path);
        } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) files.push(path);
      }
    };
    visit(sourceRoot);
    const fileSet = new Set(files);
    const graph = new Map<string, string[]>();
    for (const file of files) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/gu)]
        .map((match) => match[1])
        .filter((value): value is string => value !== undefined)
        .map((specifier) => resolve(dirname(file), specifier))
        .map((candidate) =>
          fileSet.has(`${candidate}.ts`) ? `${candidate}.ts` : join(candidate, 'index.ts'),
        )
        .filter((candidate) => fileSet.has(candidate));
      graph.set(file, imports);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const walk = (file: string): void => {
      if (visiting.has(file))
        throw new Error(`Module cycle detected at ${relative(sourceRoot, file)}`);
      if (visited.has(file)) return;
      visiting.add(file);
      for (const dependency of graph.get(file) ?? []) walk(dependency);
      visiting.delete(file);
      visited.add(file);
    };
    for (const file of files) walk(file);
    expect(visited.size).toBe(files.length);
  });
});
