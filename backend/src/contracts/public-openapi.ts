import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type OperationObject,
} from '@nestjs/swagger';

export function createPublicOpenApi(app: INestApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setTitle('SWAR REST and callback API')
    .setDescription(
      'Versioned contracts for authenticated users, internal services, and signed LiveKit webhooks. Examples are fictional.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addSecurity('mlService', { type: 'http', scheme: 'bearer' })
    .addSecurity('verifierService', { type: 'http', scheme: 'bearer' })
    .addSecurity('liveKitWebhook', { type: 'apiKey', in: 'header', name: 'Authorization' })
    .build();
  const document = SwaggerModule.createDocument(app, configuration, {
    operationIdFactory: (controller, method) =>
      `${controller.replace(/Controller$/u, '')}.${method}`,
  });
  document.servers = [{ url: '/api/v1', description: 'Versioned SWAR API base path' }];
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ErrorEnvelope = {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'message', 'requestId'],
    properties: {
      code: { type: 'string' },
      message: { type: 'string' },
      requestId: { type: 'string' },
      details: { type: 'object', additionalProperties: true },
    },
  };
  Object.assign(document.components.schemas, {
    AuthSession: {
      type: 'object',
      additionalProperties: false,
      required: ['accessToken', 'refreshToken', 'tokenType', 'expiresIn', 'principal'],
      properties: {
        accessToken: { type: 'string', readOnly: true, 'x-swar-sensitive': true },
        refreshToken: { type: 'string', readOnly: true, 'x-swar-sensitive': true },
        tokenType: { type: 'string', enum: ['Bearer'] },
        expiresIn: { type: 'integer', minimum: 1 },
        principal: {
          type: 'object',
          additionalProperties: false,
          required: ['userId', 'membershipId', 'organizationId', 'deviceId', 'roles'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
            membershipId: { type: 'string', format: 'uuid' },
            organizationId: { type: 'string', format: 'uuid' },
            deviceId: { type: 'string', format: 'uuid' },
            roles: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    Call: {
      type: 'object',
      additionalProperties: false,
      required: ['callId', 'status', 'riskPolicyVersion', 'createdAt', 'startedAt', 'endedAt'],
      properties: {
        callId: { type: 'string', format: 'uuid' },
        status: { enum: ['AUTHORIZED', 'ACTIVE', 'ENDING', 'ENDED', 'CANCELLED', 'FAILED'] },
        riskPolicyVersion: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        endedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    JoinGrant: {
      type: 'object',
      additionalProperties: false,
      required: ['roomName', 'participantIdentity', 'joinToken', 'expiresAt'],
      properties: {
        roomName: { type: 'string' },
        participantIdentity: { type: 'string' },
        joinToken: { type: 'string', readOnly: true, 'x-swar-sensitive': true },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
    ParticipantGrant: {
      allOf: [
        { $ref: '#/components/schemas/JoinGrant' },
        {
          type: 'object',
          required: ['participantId', 'role'],
          properties: {
            participantId: { type: 'string', format: 'uuid' },
            role: { enum: ['CALLER', 'CUSTOMER', 'OBSERVER'] },
          },
        },
      ],
    },
    RiskEvent: {
      type: 'object',
      additionalProperties: false,
      required: [
        'riskEventId',
        'callId',
        'eventSequence',
        'priorState',
        'state',
        'reasonCode',
        'policyVersion',
        'thresholdVersion',
        'occurredAt',
      ],
      properties: {
        riskEventId: { type: 'string', format: 'uuid' },
        callId: { type: 'string', format: 'uuid' },
        eventSequence: { type: 'string', pattern: '^\\d+$' },
        priorState: { enum: ['VERIFIED', 'UNVERIFIED', 'HIGH_RISK', 'CRITICAL'] },
        state: { enum: ['VERIFIED', 'UNVERIFIED', 'HIGH_RISK', 'CRITICAL'] },
        reasonCode: { type: 'string' },
        policyVersion: { type: 'string' },
        thresholdVersion: { type: 'string' },
        occurredAt: { type: 'string', format: 'date-time' },
      },
    },
    RiskAssessment: {
      type: 'object',
      additionalProperties: false,
      required: [
        'riskAssessmentId',
        'callId',
        'outcome',
        'effectiveState',
        'decisionMode',
        'evidenceMode',
        'productionEligible',
        'activationSuppressed',
        'reasonCode',
        'policyVersion',
        'thresholdVersion',
        'calibrationVersion',
        'proposedInterventions',
        'maxWindowSequence',
        'occurredAt',
      ],
      properties: {
        riskAssessmentId: { type: 'string', format: 'uuid' },
        callId: { type: 'string', format: 'uuid' },
        outcome: {
          enum: ['VERIFIED', 'UNVERIFIED', 'HIGH_RISK', 'CRITICAL', 'INSUFFICIENT_EVIDENCE'],
        },
        effectiveState: { enum: ['VERIFIED', 'UNVERIFIED', 'HIGH_RISK', 'CRITICAL'] },
        decisionMode: {
          enum: ['ENGINEERING_TEST', 'SHADOW', 'CALIBRATED_BLOCKED', 'PRODUCTION_ELIGIBLE'],
        },
        evidenceMode: { enum: ['SIMULATED', 'SHADOW', 'CALIBRATED'] },
        productionEligible: { type: 'boolean' },
        activationSuppressed: { type: 'boolean' },
        reasonCode: { type: 'string', maxLength: 80 },
        policyVersion: { type: 'string', maxLength: 40 },
        thresholdVersion: { type: 'string', maxLength: 80 },
        calibrationVersion: { type: 'string', maxLength: 80, nullable: true },
        proposedInterventions: {
          type: 'array',
          items: {
            enum: [
              'WARN',
              'HOLD_PROTECTED_ACTION',
              'REQUIRE_STEP_UP',
              'REQUIRE_CALLBACK',
              'END_CALL',
            ],
          },
        },
        maxWindowSequence: { type: 'string', pattern: '^\\d+$' },
        occurredAt: { type: 'string', format: 'date-time' },
      },
    },
    ActiveCallsPage: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/Call' } },
        nextCursor: { type: 'string', nullable: true },
      },
    },
    RiskEventsPage: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/RiskEvent' } },
        nextCursor: { type: 'string', nullable: true },
      },
    },
    RiskAssessmentsPage: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/RiskAssessment' } },
        nextCursor: { type: 'string', nullable: true },
      },
    },
    TrustedSpeaker: {
      type: 'object',
      additionalProperties: false,
      required: ['trustedSpeakerId', 'status', 'label'],
      properties: {
        trustedSpeakerId: { type: 'string', format: 'uuid' },
        status: { type: 'string' },
        label: { type: 'string' },
      },
    },
    Consent: {
      type: 'object',
      additionalProperties: false,
      required: ['consentId', 'trustedSpeakerId', 'status', 'expiresAt'],
      properties: {
        consentId: { type: 'string', format: 'uuid' },
        trustedSpeakerId: { type: 'string', format: 'uuid' },
        status: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    StatusResult: {
      type: 'object',
      additionalProperties: false,
      properties: {
        consentId: { type: 'string', format: 'uuid' },
        voiceprintId: { type: 'string', format: 'uuid' },
        interventionId: { type: 'string', format: 'uuid' },
        status: { type: 'string' },
      },
      required: ['status'],
    },
    Voiceprint: {
      type: 'object',
      additionalProperties: false,
      required: ['voiceprintId', 'trustedSpeakerId', 'modelVersionId', 'status'],
      properties: {
        voiceprintId: { type: 'string', format: 'uuid' },
        trustedSpeakerId: { type: 'string', format: 'uuid' },
        modelVersionId: { type: 'string', format: 'uuid' },
        status: { type: 'string' },
      },
    },
    EvidenceAccepted: {
      type: 'object',
      additionalProperties: false,
      required: ['evidenceEventId', 'eventId', 'acceptanceStatus', 'riskAssessment'],
      properties: {
        evidenceEventId: { type: 'string', format: 'uuid' },
        eventId: { type: 'string', format: 'uuid' },
        acceptanceStatus: { enum: ['ACCEPTED', 'STALE'] },
        riskAssessment: {
          type: 'object',
          additionalProperties: true,
          required: ['assessmentStatus', 'productionEligible', 'reasonCode'],
          properties: {
            assessmentStatus: { enum: ['RECORDED', 'SUPPRESSED'] },
            productionEligible: { type: 'boolean' },
            reasonCode: { type: 'string', maxLength: 80 },
          },
        },
      },
    },
    RiskPolicy: {
      type: 'object',
      additionalProperties: false,
      required: [
        'riskPolicyId',
        'policyKey',
        'version',
        'schemaVersion',
        'policyDocument',
        'status',
        'effectiveAt',
      ],
      properties: {
        riskPolicyId: { type: 'string', format: 'uuid' },
        policyKey: { type: 'string' },
        version: { type: 'string' },
        schemaVersion: { type: 'string' },
        policyDocument: { type: 'object', additionalProperties: true },
        status: { enum: ['DRAFT', 'ACTIVE', 'RETIRED'] },
        effectiveAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    VerificationChallenge: {
      type: 'object',
      additionalProperties: false,
      required: ['challengeId', 'interventionId', 'status', 'method', 'expiresAt'],
      properties: {
        challengeId: { type: 'string', format: 'uuid' },
        interventionId: { type: 'string', format: 'uuid' },
        status: { enum: ['PENDING', 'PASSED', 'FAILED', 'EXPIRED', 'CANCELLED'] },
        method: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
        resultCode: { type: 'string', nullable: true },
      },
    },
    VerificationResult: {
      type: 'object',
      additionalProperties: false,
      required: ['challengeId', 'status', 'resultCode'],
      properties: {
        challengeId: { type: 'string', format: 'uuid' },
        status: { enum: ['PASSED', 'FAILED'] },
        resultCode: { type: 'string' },
      },
    },
  });
  const responseSchemas: Record<string, string> = {
    'Auth.login': 'AuthSession',
    'Auth.refresh': 'AuthSession',
    'Calls.create': 'Call',
    'Calls.invite': 'ParticipantGrant',
    'Calls.join': 'JoinGrant',
    'Calls.end': 'Call',
    'Calls.active': 'ActiveCallsPage',
    'Calls.riskEvents': 'RiskEventsPage',
    'Calls.riskAssessments': 'RiskAssessmentsPage',
    'TrustedSpeakers.create': 'TrustedSpeaker',
    'TrustedSpeakers.consent': 'Consent',
    'TrustedSpeakers.revoke': 'StatusResult',
    'TrustedSpeakers.deleteVoiceprint': 'StatusResult',
    'VoiceEnrollment.enroll': 'Voiceprint',
    'InternalEvidence.ingest': 'EvidenceAccepted',
    'RiskPolicy.active': 'RiskPolicy',
    'RiskPolicy.put': 'RiskPolicy',
    'Interventions.request': 'VerificationChallenge',
    'Interventions.complete': 'VerificationResult',
    'Interventions.release': 'StatusResult',
  };
  const permissions: Record<string, string[]> = {
    'Calls.create': ['call.create'],
    'Calls.invite': ['call.create'],
    'Calls.join': ['call.read'],
    'Calls.end': ['call.end'],
    'Calls.active': ['call.read'],
    'Calls.riskEvents': ['risk-event.read'],
    'Calls.riskAssessments': ['risk-event.read'],
    'TrustedSpeakers.create': ['enrollment.manage'],
    'TrustedSpeakers.consent': ['enrollment.manage'],
    'TrustedSpeakers.revoke': ['enrollment.manage'],
    'TrustedSpeakers.deleteVoiceprint': ['voiceprint.delete'],
    'VoiceEnrollment.enroll': ['enrollment.manage'],
    'RiskPolicy.active': ['risk-policy.read'],
    'RiskPolicy.put': ['risk-policy.manage'],
    'Interventions.request': ['intervention.resolve'],
    'Interventions.release': ['intervention.resolve'],
  };
  const sensitive = new Set([
    'Auth.login',
    'Auth.refresh',
    'Auth.revoke',
    'Calls.join',
    'TrustedSpeakers.create',
    'TrustedSpeakers.consent',
    'TrustedSpeakers.revoke',
    'TrustedSpeakers.deleteVoiceprint',
    'VoiceEnrollment.enroll',
    'RiskPolicy.put',
    'Interventions.request',
    'Interventions.complete',
    'Interventions.release',
  ]);
  const queries = new Set([
    'Calls.active',
    'Calls.riskEvents',
    'Calls.riskAssessments',
    'RiskPolicy.active',
  ]);
  const idempotent = new Set([
    'Calls.create',
    'Calls.invite',
    'Calls.end',
    'TrustedSpeakers.create',
    'TrustedSpeakers.consent',
    'TrustedSpeakers.revoke',
    'TrustedSpeakers.deleteVoiceprint',
    'VoiceEnrollment.enroll',
    'InternalEvidence.ingest',
    'RiskPolicy.put',
    'Interventions.request',
    'Interventions.release',
    'LiveKitWebhook.receive',
  ]);
  const operationErrorCodes: Record<string, string[]> = {
    'Auth.login': ['AUTHENTICATION_FAILED', 'AUTH_RATE_LIMITED', 'DEPENDENCY_UNAVAILABLE'],
    'Auth.refresh': ['TOKEN_INVALID', 'REFRESH_REUSE_DETECTED', 'DEPENDENCY_UNAVAILABLE'],
    'Auth.revoke': ['TOKEN_INVALID', 'DEPENDENCY_UNAVAILABLE'],
    'Calls.create': ['NOT_FOUND', 'CONFLICT', 'DOMAIN_PROVIDER_FAILED'],
    'Calls.invite': ['NOT_FOUND', 'CONFLICT', 'DOMAIN_PROVIDER_FAILED'],
    'Calls.join': ['NOT_FOUND', 'CONFLICT', 'DOMAIN_PROVIDER_FAILED'],
    'Calls.end': ['NOT_FOUND', 'CONFLICT', 'ILLEGAL_DOMAIN_TRANSITION', 'DOMAIN_PROVIDER_FAILED'],
    'Calls.active': ['PAGINATION_CURSOR_INVALID', 'DEPENDENCY_UNAVAILABLE'],
    'Calls.riskEvents': ['NOT_FOUND', 'PAGINATION_CURSOR_INVALID', 'DEPENDENCY_UNAVAILABLE'],
    'Calls.riskAssessments': ['NOT_FOUND', 'PAGINATION_CURSOR_INVALID', 'DEPENDENCY_UNAVAILABLE'],
    'TrustedSpeakers.create': ['NOT_FOUND', 'CONFLICT', 'DEPENDENCY_UNAVAILABLE'],
    'TrustedSpeakers.consent': ['NOT_FOUND', 'CONFLICT', 'DEPENDENCY_UNAVAILABLE'],
    'TrustedSpeakers.revoke': ['NOT_FOUND', 'CONFLICT', 'DOMAIN_PROVIDER_FAILED'],
    'TrustedSpeakers.deleteVoiceprint': ['NOT_FOUND', 'CONFLICT', 'DOMAIN_PROVIDER_FAILED'],
    'VoiceEnrollment.enroll': [
      'NOT_FOUND',
      'CONFLICT',
      'DOMAIN_INPUT_INVALID',
      'DOMAIN_PROVIDER_FAILED',
    ],
    'InternalEvidence.ingest': [
      'IDEMPOTENCY_EVENT_MISMATCH',
      'EVIDENCE_CONTRACT_INVALID',
      'ANALYSIS_BINDING_CONFLICT',
      'NOT_FOUND',
      'CONFLICT',
    ],
    'RiskPolicy.active': ['NOT_FOUND', 'DEPENDENCY_UNAVAILABLE'],
    'RiskPolicy.put': [
      'NOT_FOUND',
      'CONFLICT',
      'RISK_POLICY_INVALID',
      'RISK_PRODUCTION_ACTIVATION_BLOCKED',
      'DEPENDENCY_UNAVAILABLE',
    ],
    'LiveKitWebhook.receive': [
      'WEBHOOK_AUTHENTICATION_FAILED',
      'WEBHOOK_EVENT_INVALID',
      'CONFLICT',
    ],
    'Interventions.request': ['NOT_FOUND', 'CONFLICT', 'STEP_UP_NOT_REQUIRED'],
    'Interventions.complete': ['NOT_FOUND', 'CONFLICT'],
    'Interventions.release': ['NOT_FOUND', 'CONFLICT', 'DOMAIN_PROVIDER_FAILED'],
  };
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
  for (const pathItem of Object.values(document.paths)) {
    for (const method of methods) {
      const operation: OperationObject | undefined = pathItem[method];
      if (operation === undefined) continue;
      const responses = operation.responses;
      const operationRecord = operation as unknown as Record<string, unknown>;
      const operationId = String(operation.operationId ?? '');
      const responseSchema = responseSchemas[operationId];
      if (responseSchema !== undefined) {
        const success = Object.entries(responses).find(([status]) => /^2\d\d$/u.test(status));
        if (success !== undefined) {
          success[1] = {
            ...success[1],
            description: 'Successful response.',
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${responseSchema}` } },
            },
          };
          responses[success[0]] = success[1];
        }
      }
      const authKind =
        operationId === 'InternalEvidence.ingest'
          ? 'ML_SERVICE'
          : operationId === 'Interventions.complete'
            ? 'VERIFIER_SERVICE'
            : operationId === 'LiveKitWebhook.receive'
              ? 'SIGNED_WEBHOOK'
              : operationId.startsWith('Auth.') || operationId.startsWith('Health.')
                ? 'PUBLIC'
                : 'USER_ACCESS_JWT';
      operationRecord['x-swar-auth-kind'] = authKind;
      operationRecord['x-swar-required-permissions'] = permissions[operationId] ?? [];
      const rateLimitCategory = sensitive.has(operationId)
        ? 'SENSITIVE'
        : queries.has(operationId)
          ? 'QUERY'
          : operationId.startsWith('Health.') || operationId === 'LiveKitWebhook.receive'
            ? 'NONE'
            : 'MUTATION';
      operationRecord['x-swar-rate-limit-category'] = rateLimitCategory;
      operationRecord['x-swar-idempotency'] = idempotent.has(operationId)
        ? operationId === 'LiveKitWebhook.receive'
          ? 'VERIFIED_EVENT_ID_AND_BODY_HASH'
          : operationId === 'InternalEvidence.ingest'
            ? 'IDEMPOTENCY_KEY_EQUALS_EVENT_ID'
            : 'IDEMPOTENCY_KEY_REQUIRED'
        : 'NOT_APPLICABLE';
      const documentedErrors = new Set<string>(['VALIDATION_FAILED', 'INTERNAL_ERROR']);
      if (rateLimitCategory !== 'NONE') documentedErrors.add('RATE_LIMITED');
      if (authKind === 'USER_ACCESS_JWT') {
        documentedErrors.add('TOKEN_INVALID');
        documentedErrors.add('FORBIDDEN');
      } else if (authKind === 'ML_SERVICE' || authKind === 'VERIFIER_SERVICE') {
        documentedErrors.add('TOKEN_INVALID');
      }
      if (idempotent.has(operationId) && operationId !== 'LiveKitWebhook.receive') {
        documentedErrors.add('IDEMPOTENCY_KEY_REQUIRED');
        documentedErrors.add('IDEMPOTENCY_KEY_CONFLICT');
      }
      for (const code of operationErrorCodes[operationId] ?? []) documentedErrors.add(code);
      operationRecord['x-swar-error-codes'] = [...documentedErrors].sort();
      responses.default = {
        description: 'Stable non-sensitive error envelope.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
      };
    }
  }
  return document;
}
