import { InvalidPaginationCursorError } from './database.errors';
import { requireUuid } from './database.types';

export interface TimeKeysetCursor {
  timestamp: Date;
  id: string;
}

export interface PageRequest {
  cursor?: string;
  limit?: number;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 25;
const MAXIMUM_PAGE_SIZE = 100;
const MAXIMUM_CURSOR_LENGTH = 512;

export function pageLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAXIMUM_PAGE_SIZE) {
    throw new InvalidPaginationCursorError();
  }
  return limit;
}

export function encodeTimeCursor(cursor: TimeKeysetCursor): string {
  return Buffer.from(
    JSON.stringify({ timestamp: cursor.timestamp.toISOString(), id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeTimeCursor(value: string | undefined): TimeKeysetCursor | null {
  if (value === undefined) {
    return null;
  }
  if (value.length === 0 || value.length > MAXIMUM_CURSOR_LENGTH) {
    throw new InvalidPaginationCursorError();
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      timestamp?: unknown;
      id?: unknown;
    };
    if (typeof decoded.timestamp !== 'string' || typeof decoded.id !== 'string') {
      throw new InvalidPaginationCursorError();
    }
    const timestamp = new Date(decoded.timestamp);
    if (Number.isNaN(timestamp.getTime())) {
      throw new InvalidPaginationCursorError();
    }
    return { timestamp, id: requireUuid(decoded.id, 'cursor.id') };
  } catch (error) {
    if (error instanceof InvalidPaginationCursorError) {
      throw error;
    }
    throw new InvalidPaginationCursorError();
  }
}
