import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from './prisma.service';
import type { TransactionClient } from './database.types';

const MAX_TRANSACTION_ATTEMPTS = 5;
const RETRYABLE_TRANSACTION_CODES = new Set(['P2034']);

function isRetryableWriteConflict(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      RETRYABLE_TRANSACTION_CODES.has(error.code)) ||
    (error instanceof Error && error.message.includes('TransactionWriteConflict'))
  );
}

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async serializable<T>(operation: (transaction: TransactionClient) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.client.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error) {
        lastError = error;
        if (!isRetryableWriteConflict(error) || attempt === MAX_TRANSACTION_ATTEMPTS) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }
}
