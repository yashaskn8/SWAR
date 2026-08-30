import { createHash, createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { Injectable } from '@nestjs/common';

import { ConfigurationService } from '../../config/configuration';
import { MlControlPort, type MlAnalysisGrant, type MlEnrollmentResult } from './ml-control.port';

interface JsonObject {
  readonly [key: string]: unknown;
}

class MlControlError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MlControlError';
  }
}

@Injectable()
export class MlControlClient extends MlControlPort {
  constructor(private readonly configuration: ConfigurationService) {
    super();
  }

  async startAnalysis(grant: MlAnalysisGrant): Promise<void> {
    await this.request(
      'POST',
      '/internal/v1/analysis-sessions',
      `analysis-start:${grant.sessionId}`,
      {
        schemaVersion: '2.0.0',
        organizationId: grant.organizationId,
        analysisSessionId: grant.sessionId,
        callId: grant.callId,
        trackBindingId: grant.bindingId,
        bindingRevision: grant.bindingRevision,
        evidenceMode: grant.evidenceMode,
        roomName: grant.roomName,
        participantIdentity: grant.participantIdentity,
        trackSid: grant.trackSid,
        grantToken: grant.grantToken,
        grantExpiresAt: grant.grantExpiresAt.toISOString(),
        ...(grant.voiceprintId === undefined ? {} : { voiceprintReference: grant.voiceprintId }),
      },
      new Set([202]),
    );
  }

  async stopAnalysis(input: { sessionId: string; reasonCode: string }): Promise<void> {
    await this.request(
      'POST',
      `/internal/v1/analysis-sessions/${encodeURIComponent(input.sessionId)}/stop`,
      `analysis-stop:${input.sessionId}:${input.reasonCode}`,
      { reasonCode: input.reasonCode },
      new Set([204]),
    );
  }

  async inferEnrollment(input: {
    enrollmentOperationId: string;
    consentId: string;
    expectedModelVersionId: string;
    samples: readonly Uint8Array[];
  }): Promise<MlEnrollmentResult> {
    const response = await this.request(
      'POST',
      '/internal/v1/enrollment-inferences',
      `enrollment:${input.enrollmentOperationId}`,
      {
        schemaVersion: '1.0.0',
        enrollmentOperationId: input.enrollmentOperationId,
        consentId: input.consentId,
        expectedModelVersionId: input.expectedModelVersionId,
        samples: input.samples.map((sample) => Buffer.from(sample).toString('base64')),
      },
      new Set([200]),
    );
    if (
      typeof response.modelVersionId !== 'string' ||
      typeof response.embeddingFormat !== 'string' ||
      typeof response.acceptedSampleCount !== 'number' ||
      typeof response.embedding !== 'string'
    ) {
      throw new MlControlError('ML_CONTROL_RESPONSE_INVALID');
    }
    const decoded = Buffer.from(response.embedding, 'base64');
    if (decoded.byteLength === 0) throw new MlControlError('ML_CONTROL_RESPONSE_INVALID');
    return {
      modelVersionId: response.modelVersionId,
      embeddingFormat: response.embeddingFormat,
      acceptedSampleCount: response.acceptedSampleCount,
      embedding: new Uint8Array(decoded),
    };
  }

  async cancelEnrollment(input: {
    enrollmentOperationId: string;
    reasonCode: string;
  }): Promise<void> {
    await this.request(
      'POST',
      `/internal/v1/enrollment-inferences/${encodeURIComponent(input.enrollmentOperationId)}/cancel`,
      `enrollment-cancel:${input.enrollmentOperationId}:${input.reasonCode}`,
      { reasonCode: input.reasonCode },
      new Set([204]),
    );
  }

  private async request(
    method: 'POST',
    path: string,
    idempotencyKey: string,
    payload: JsonObject,
    acceptedStatuses: ReadonlySet<number>,
  ): Promise<JsonObject> {
    const { dependencies } = this.configuration.values;
    const body = JSON.stringify(payload);
    const url = new URL(path, `${dependencies.mlInternalUrl.replace(/\/$/u, '')}/`);
    let lastCode = 'ML_CONTROL_UNAVAILABLE';
    for (let attempt = 1; attempt <= dependencies.mlControlMaximumAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), dependencies.httpTimeoutMs);
      try {
        const headers = this.signedHeaders(method, url.pathname, idempotencyKey, body);
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        if (acceptedStatuses.has(response.status)) {
          if (response.status === 204) return {};
          return (await response.json()) as JsonObject;
        }
        lastCode = response.status >= 500 ? 'ML_CONTROL_UNAVAILABLE' : 'ML_CONTROL_REJECTED';
        if (response.status < 500) throw new MlControlError(lastCode);
      } catch (error) {
        if (error instanceof MlControlError && error.code === 'ML_CONTROL_REJECTED') throw error;
        lastCode = error instanceof MlControlError ? error.code : 'ML_CONTROL_UNAVAILABLE';
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < dependencies.mlControlMaximumAttempts) {
        await delay(dependencies.mlControlRetryBackoffMs * attempt);
      }
    }
    throw new MlControlError(lastCode);
  }

  private signedHeaders(
    method: string,
    path: string,
    idempotencyKey: string,
    body: string,
  ): Record<string, string> {
    const secret = this.configuration.values.secrets.mlInternalSecret;
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const nonce = randomUUID();
    const bodySha256 = createHash('sha256').update(body).digest('hex');
    const canonical = [method, path, timestamp, nonce, idempotencyKey, bodySha256].join('\n');
    const signature = createHmac('sha256', secret).update(canonical).digest('hex');
    return {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      'X-SWAR-Service': 'swar-backend',
      'X-SWAR-Timestamp': timestamp,
      'X-SWAR-Nonce': nonce,
      'X-SWAR-Signature': signature,
      'Idempotency-Key': idempotencyKey,
    };
  }
}
