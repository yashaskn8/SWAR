import { createCipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigurationService } from '../../config/configuration';
import type { EncryptedVoiceprintEnvelope } from '../enrollment/enrollment.repository';
import { DomainInputError } from '../domain/domain.errors';

@Injectable()
export class VoiceprintCipherService {
  constructor(private readonly configuration: ConfigurationService) {}

  encrypt(input: {
    embedding: Uint8Array;
    embeddingFormat: string;
    sampleCount: number;
  }): EncryptedVoiceprintEnvelope {
    if (input.embedding.byteLength === 0) throw new DomainInputError('Embedding is empty.');
    const key = Buffer.from(this.configuration.values.secrets.voiceprintEncryptionKey, 'base64');
    const iv = randomBytes(12);
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(Buffer.from(input.embedding)),
        cipher.final(),
      ]);
      const authenticationTag = cipher.getAuthTag();
      return {
        kind: 'encrypted-voiceprint-v1',
        ciphertext: Buffer.concat([iv, authenticationTag, encrypted]),
        encryptionAlgorithm: 'AES-256-GCM-IV12-TAG16-PREFIXED',
        encryptionKeyVersion: this.configuration.values.secrets.voiceprintEncryptionKeyVersion,
        embeddingFormat: input.embeddingFormat,
        sampleCount: input.sampleCount,
      };
    } finally {
      key.fill(0);
    }
  }
}
