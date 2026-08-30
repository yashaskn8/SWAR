export type SwarEnvironment = 'development' | 'test' | 'production';
export type MlEvidenceMode = 'SIMULATED' | 'SHADOW' | 'CALIBRATED';
export type RiskInterventionMode = 'ENGINEERING_ONLY' | 'PRODUCTION';
export type PhaseOScientificStatus = 'BLOCKED' | 'PROMOTED';
export type PhasePProductionStatus = 'BLOCKED_BY_PHASE_O' | 'PROMOTED';
export type PhaseQProductionStatus = 'ENGINEERING_ONLY' | 'PROMOTED';

export interface ApplicationConfiguration {
  runtime: {
    environment: SwarEnvironment;
    host: string;
    port: number;
    publicApiUrl: string;
    securityWebSocketUrl: string;
    corsAllowedOrigins: string[];
    bodyLimitBytes: number;
    inboundRequestTimeoutMs: number;
    shutdownTimeoutMs: number;
  };
  database: {
    url: string;
    poolMax: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
  };
  auth: {
    accessSecret: string;
    refreshSecret: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    clockToleranceSeconds: number;
    refreshTtlSeconds: number;
    loginMaximumAttempts: number;
    loginWindowSeconds: number;
  };
  dependencies: {
    mlInternalUrl: string;
    mlEvidenceMode: MlEvidenceMode;
    mlControlMaximumAttempts: number;
    mlControlRetryBackoffMs: number;
    internalAuthClockSkewSeconds: number;
    liveKitUrl: string;
    httpTimeoutMs: number;
    webSocketTimeoutMs: number;
    liveKitParticipantGrantTtlSeconds: number;
    analysisSessionTtlSeconds: number;
  };
  risk: {
    interventionMode: RiskInterventionMode;
    phaseOScientificStatus: PhaseOScientificStatus;
    phasePProductionStatus: PhasePProductionStatus;
    phaseQProductionStatus: PhaseQProductionStatus;
  };
  secrets: {
    mlInternalSecret: string;
    verificationCallbackSecret: string;
    liveKitApiKey: string;
    liveKitApiSecret: string;
    voiceprintEncryptionKey: string;
    voiceprintEncryptionKeyVersion: string;
  };
  idempotency: {
    ttlSeconds: number;
    maximumEntries: number;
  };
  api: {
    rateLimitWindowSeconds: number;
    sensitiveRateLimitMaximum: number;
    mutationRateLimitMaximum: number;
    queryRateLimitMaximum: number;
    securityEventReplayMaximum: number;
    securitySubscriptionMaximumCalls: number;
    securityInboundRateLimitMaximum: number;
    enrollmentMaximumSamples: number;
    enrollmentMaximumSampleBytes: number;
    enrollmentMaximumTotalBytes: number;
    enrollmentMaximumDeclaredDurationMs: number;
    stepUpChallengeTtlSeconds: number;
  };
}

export class EnvironmentValidationError extends Error {
  readonly code = 'ENVIRONMENT_INVALID';
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    const unique = [...new Set(variables)].sort();
    super(`Invalid backend environment variables: ${unique.join(', ')}.`);
    this.name = 'EnvironmentValidationError';
    this.variables = unique;
  }
}

const insecureSecret = /(replace_with|change.?me|development_secret|example_secret)/iu;

class Reader {
  readonly invalid: string[] = [];

  constructor(private readonly source: NodeJS.ProcessEnv) {}

  text(name: string, maximum = 2_048): string {
    const value = this.source[name]?.trim();
    if (value === undefined || value.length === 0 || value.length > maximum) {
      this.invalid.push(name);
      return '';
    }
    return value;
  }

  integer(name: string, minimum: number, maximum: number): number {
    const raw = this.text(name, 20);
    const value = Number(raw);
    if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
      this.invalid.push(name);
      return minimum;
    }
    return value;
  }

  secret(name: string, minimumBytes = 32): string {
    const value = this.text(name, 4_096);
    if (Buffer.byteLength(value, 'utf8') < minimumBytes || insecureSecret.test(value)) {
      this.invalid.push(name);
    }
    return value;
  }

  url(name: string, protocols: readonly string[], productionProtocols?: readonly string[]): string {
    const value = this.text(name);
    try {
      const parsed = new URL(value);
      const allowed =
        this.source.SWAR_ENV === 'production' && productionProtocols !== undefined
          ? productionProtocols
          : protocols;
      if (
        !allowed.includes(parsed.protocol) ||
        parsed.hostname.length === 0 ||
        parsed.username.length > 0 ||
        parsed.password.length > 0
      ) {
        this.invalid.push(name);
      }
    } catch {
      this.invalid.push(name);
    }
    return value;
  }
}

function parseEnvironmentName(reader: Reader): SwarEnvironment {
  const value = reader.text('SWAR_ENV', 20);
  if (!['development', 'test', 'production'].includes(value)) {
    reader.invalid.push('SWAR_ENV');
    return 'development';
  }
  return value as SwarEnvironment;
}

function parseEvidenceMode(reader: Reader): MlEvidenceMode {
  const value = reader.text('ML_EVIDENCE_MODE', 20).toUpperCase();
  if (!['SIMULATED', 'SHADOW', 'CALIBRATED'].includes(value)) {
    reader.invalid.push('ML_EVIDENCE_MODE');
    return 'SHADOW';
  }
  return value as MlEvidenceMode;
}

function parseEnum<T extends string>(reader: Reader, name: string, allowed: readonly T[]): T {
  const value = reader.text(name, 40).toUpperCase();
  if (!allowed.includes(value as T)) {
    reader.invalid.push(name);
    return allowed[0]!;
  }
  return value as T;
}

function parseCors(
  reader: Reader,
  source: NodeJS.ProcessEnv,
  environment: SwarEnvironment,
): string[] {
  const raw = reader.text('CORS_ALLOWED_ORIGINS', 4_096);
  const origins = [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (origins.length === 0 || origins.includes('*')) reader.invalid.push('CORS_ALLOWED_ORIGINS');
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== origin ||
        (environment === 'production' && url.protocol !== 'https:')
      ) {
        reader.invalid.push('CORS_ALLOWED_ORIGINS');
      }
    } catch {
      reader.invalid.push('CORS_ALLOWED_ORIGINS');
    }
  }
  return origins;
}

export function parseEnvironment(source: NodeJS.ProcessEnv): ApplicationConfiguration {
  const reader = new Reader(source);
  const environment = parseEnvironmentName(reader);
  const accessSecret = reader.secret('JWT_ACCESS_SECRET');
  const refreshSecret = reader.secret('JWT_REFRESH_SECRET');
  if (accessSecret === refreshSecret) {
    reader.invalid.push('JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET');
  }
  const voiceprintEncryptionKey = reader.text('VOICEPRINT_ENCRYPTION_KEY', 256);
  try {
    const decoded = Buffer.from(voiceprintEncryptionKey, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== voiceprintEncryptionKey) {
      reader.invalid.push('VOICEPRINT_ENCRYPTION_KEY');
    }
  } catch {
    reader.invalid.push('VOICEPRINT_ENCRYPTION_KEY');
  }

  const databaseUrl = reader.text('DATABASE_URL', 4_096);
  try {
    const parsed = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      parsed.hostname.length === 0 ||
      parsed.pathname.length <= 1 ||
      (environment === 'production' && parsed.password.length === 0)
    ) {
      reader.invalid.push('DATABASE_URL');
    }
  } catch {
    reader.invalid.push('DATABASE_URL');
  }

  const configuration: ApplicationConfiguration = {
    runtime: {
      environment,
      host: reader.text('BACKEND_HOST', 255),
      port: reader.integer('BACKEND_PORT', 1, 65_535),
      publicApiUrl: reader.url('PUBLIC_API_URL', ['http:', 'https:'], ['https:']),
      securityWebSocketUrl: reader.url('SECURITY_WS_URL', ['ws:', 'wss:'], ['wss:']),
      corsAllowedOrigins: parseCors(reader, source, environment),
      bodyLimitBytes: reader.integer('HTTP_BODY_LIMIT_BYTES', 1_024, 1_048_576),
      inboundRequestTimeoutMs: reader.integer('HTTP_REQUEST_TIMEOUT_MS', 1_000, 120_000),
      shutdownTimeoutMs: reader.integer('SHUTDOWN_TIMEOUT_MS', 1_000, 60_000),
    },
    database: {
      url: databaseUrl,
      poolMax: reader.integer('POSTGRES_POOL_MAX', 1, 100),
      idleTimeoutMs: reader.integer('POSTGRES_IDLE_TIMEOUT_MS', 1_000, 300_000),
      connectionTimeoutMs: reader.integer('POSTGRES_CONNECTION_TIMEOUT_MS', 100, 60_000),
    },
    auth: {
      accessSecret,
      refreshSecret,
      issuer: reader.text('JWT_ISSUER', 160),
      audience: reader.text('JWT_AUDIENCE', 160),
      accessTtlSeconds: reader.integer('JWT_ACCESS_TTL_SECONDS', 60, 3_600),
      clockToleranceSeconds: reader.integer('JWT_CLOCK_TOLERANCE_SECONDS', 0, 60),
      refreshTtlSeconds: reader.integer('REFRESH_SESSION_TTL_SECONDS', 300, 2_592_000),
      loginMaximumAttempts: reader.integer('AUTH_LOGIN_MAX_ATTEMPTS', 1, 100),
      loginWindowSeconds: reader.integer('AUTH_LOGIN_WINDOW_SECONDS', 1, 3_600),
    },
    dependencies: {
      mlInternalUrl: reader.url('ML_INTERNAL_URL', ['http:', 'https:'], ['https:']),
      mlEvidenceMode: parseEvidenceMode(reader),
      mlControlMaximumAttempts: reader.integer('ML_CONTROL_MAX_ATTEMPTS', 1, 5),
      mlControlRetryBackoffMs: reader.integer('ML_CONTROL_RETRY_BACKOFF_MS', 10, 5_000),
      internalAuthClockSkewSeconds: reader.integer('INTERNAL_AUTH_CLOCK_SKEW_SECONDS', 1, 300),
      liveKitUrl: reader.url('LIVEKIT_URL', ['ws:', 'wss:'], ['wss:']),
      httpTimeoutMs: reader.integer('DOWNSTREAM_HTTP_TIMEOUT_MS', 100, 30_000),
      webSocketTimeoutMs: reader.integer('DOWNSTREAM_WEBSOCKET_TIMEOUT_MS', 100, 30_000),
      liveKitParticipantGrantTtlSeconds: reader.integer(
        'LIVEKIT_PARTICIPANT_GRANT_TTL_SECONDS',
        30,
        900,
      ),
      analysisSessionTtlSeconds: reader.integer('ANALYSIS_SESSION_TTL_SECONDS', 30, 3_600),
    },
    risk: {
      interventionMode: parseEnum(reader, 'RISK_INTERVENTION_MODE', [
        'ENGINEERING_ONLY',
        'PRODUCTION',
      ] as const),
      phaseOScientificStatus: parseEnum(reader, 'PHASE_O_SCIENTIFIC_STATUS', [
        'BLOCKED',
        'PROMOTED',
      ] as const),
      phasePProductionStatus: parseEnum(reader, 'PHASE_P_PRODUCTION_STATUS', [
        'BLOCKED_BY_PHASE_O',
        'PROMOTED',
      ] as const),
      phaseQProductionStatus: parseEnum(reader, 'PHASE_Q_PRODUCTION_STATUS', [
        'ENGINEERING_ONLY',
        'PROMOTED',
      ] as const),
    },
    secrets: {
      mlInternalSecret: reader.secret('ML_INTERNAL_SECRET'),
      verificationCallbackSecret: reader.secret('VERIFICATION_CALLBACK_SECRET'),
      liveKitApiKey: reader.secret('LIVEKIT_API_KEY', 8),
      liveKitApiSecret: reader.secret('LIVEKIT_API_SECRET'),
      voiceprintEncryptionKey,
      voiceprintEncryptionKeyVersion: reader.text('VOICEPRINT_ENCRYPTION_KEY_VERSION', 128),
    },
    idempotency: {
      ttlSeconds: reader.integer('IDEMPOTENCY_TTL_SECONDS', 60, 86_400),
      maximumEntries: reader.integer('IDEMPOTENCY_MAX_ENTRIES', 100, 100_000),
    },
    api: {
      rateLimitWindowSeconds: reader.integer('API_RATE_LIMIT_WINDOW_SECONDS', 1, 3_600),
      sensitiveRateLimitMaximum: reader.integer('API_SENSITIVE_RATE_LIMIT_MAX', 1, 1_000),
      mutationRateLimitMaximum: reader.integer('API_MUTATION_RATE_LIMIT_MAX', 1, 10_000),
      queryRateLimitMaximum: reader.integer('API_QUERY_RATE_LIMIT_MAX', 1, 100_000),
      securityEventReplayMaximum: reader.integer('SECURITY_WS_REPLAY_MAX_EVENTS', 1, 10_000),
      securitySubscriptionMaximumCalls: reader.integer(
        'SECURITY_WS_SUBSCRIPTION_MAX_CALLS',
        1,
        1_000,
      ),
      securityInboundRateLimitMaximum: reader.integer(
        'SECURITY_WS_INBOUND_RATE_LIMIT_MAX',
        1,
        10_000,
      ),
      enrollmentMaximumSamples: reader.integer('ENROLLMENT_MAX_SAMPLES', 1, 20),
      enrollmentMaximumSampleBytes: reader.integer(
        'ENROLLMENT_MAX_SAMPLE_BYTES',
        1_024,
        10_485_760,
      ),
      enrollmentMaximumTotalBytes: reader.integer('ENROLLMENT_MAX_TOTAL_BYTES', 1_024, 52_428_800),
      enrollmentMaximumDeclaredDurationMs: reader.integer(
        'ENROLLMENT_MAX_DECLARED_DURATION_MS',
        250,
        300_000,
      ),
      stepUpChallengeTtlSeconds: reader.integer('STEP_UP_CHALLENGE_TTL_SECONDS', 30, 3_600),
    },
  };
  if (
    configuration.api.enrollmentMaximumTotalBytes < configuration.api.enrollmentMaximumSampleBytes
  ) {
    reader.invalid.push('ENROLLMENT_MAX_TOTAL_BYTES');
  }
  if (
    configuration.runtime.environment === 'production' &&
    configuration.dependencies.mlEvidenceMode !== 'CALIBRATED'
  ) {
    reader.invalid.push('ML_EVIDENCE_MODE');
  }
  if (
    configuration.risk.interventionMode === 'PRODUCTION' &&
    (configuration.risk.phaseOScientificStatus !== 'PROMOTED' ||
      configuration.risk.phasePProductionStatus !== 'PROMOTED' ||
      configuration.risk.phaseQProductionStatus !== 'PROMOTED')
  ) {
    reader.invalid.push(
      'RISK_INTERVENTION_MODE',
      'PHASE_O_SCIENTIFIC_STATUS',
      'PHASE_P_PRODUCTION_STATUS',
      'PHASE_Q_PRODUCTION_STATUS',
    );
  }
  if (
    configuration.risk.phasePProductionStatus === 'PROMOTED' &&
    configuration.risk.phaseOScientificStatus !== 'PROMOTED'
  ) {
    reader.invalid.push('PHASE_O_SCIENTIFIC_STATUS', 'PHASE_P_PRODUCTION_STATUS');
  }
  if (reader.invalid.length > 0) throw new EnvironmentValidationError(reader.invalid);
  return configuration;
}
