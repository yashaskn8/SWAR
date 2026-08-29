import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { PrismaClient } from '../generated/prisma/client';
import { DatabaseUnavailableError } from './database.errors';
import { createPrismaClient } from './prisma-client.factory';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  constructor() {
    this.client = createPrismaClient();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      await this.client.$queryRaw`SELECT 1`;
    } catch {
      this.logger.error(
        JSON.stringify({ event: 'database.connection.failed', code: 'DATABASE_UNAVAILABLE' }),
      );
      await this.client.$disconnect().catch(() => undefined);
      throw new DatabaseUnavailableError();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
