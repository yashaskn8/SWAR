import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface RequestContextState {
  requestId: string;
  method: string;
  path: string;
}

export interface RequestWithContext extends Request {
  requestId?: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextState>();

  run<T>(state: RequestContextState, operation: () => T): T {
    return this.storage.run(state, operation);
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  requireRequestId(): string {
    const requestId = this.getRequestId();
    if (requestId === undefined) throw new Error('Request context is unavailable.');
    return requestId;
  }

  outboundHeaders(): Readonly<Record<string, string>> {
    const requestId = this.getRequestId();
    return requestId === undefined ? {} : { 'x-request-id': requestId };
  }
}

export function resolveRequestId(value: string | string[] | undefined): string {
  const selected = Array.isArray(value) ? undefined : value;
  return selected !== undefined && requestIdPattern.test(selected) ? selected : randomUUID();
}
