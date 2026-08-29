import { Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash: string | undefined;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('base64url'));
  }

  hash(password: string): Promise<string> {
    if (password.length < 12 || password.length > 1_024) {
      throw new Error('Password length is outside the accepted range.');
    }
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    const selectedHash = passwordHash ?? this.dummyHash;
    if (selectedHash === undefined) throw new Error('Password service is not initialized.');
    try {
      const matches = await verify(selectedHash, password);
      return passwordHash !== null && matches;
    } catch {
      return false;
    }
  }
}
