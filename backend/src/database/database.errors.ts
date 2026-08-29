export class DatabaseConfigurationError extends Error {
  readonly code = 'DATABASE_CONFIGURATION_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigurationError';
  }
}

export class DatabaseUnavailableError extends Error {
  readonly code = 'DATABASE_UNAVAILABLE';

  constructor() {
    super('Database connectivity is unavailable.');
    this.name = 'DatabaseUnavailableError';
  }
}

export class TenantResourceNotFoundError extends Error {
  readonly code = 'TENANT_RESOURCE_NOT_FOUND';

  constructor(resource: string) {
    super(`${resource} was not found in the authorized organization.`);
    this.name = 'TenantResourceNotFoundError';
  }
}

export class PersistenceConflictError extends Error {
  readonly code = 'PERSISTENCE_CONFLICT';

  constructor(message = 'The requested state conflicts with persisted state.') {
    super(message);
    this.name = 'PersistenceConflictError';
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_CONFLICT';

  constructor() {
    super('The idempotency key was already used for different input.');
    this.name = 'IdempotencyConflictError';
  }
}

export class InvalidEncryptedPayloadError extends Error {
  readonly code = 'ENCRYPTED_VOICEPRINT_REQUIRED';

  constructor() {
    super('A non-empty encrypted voiceprint envelope is required.');
    this.name = 'InvalidEncryptedPayloadError';
  }
}

export class InvalidPaginationCursorError extends Error {
  readonly code = 'PAGINATION_CURSOR_INVALID';

  constructor() {
    super('The pagination cursor is invalid.');
    this.name = 'InvalidPaginationCursorError';
  }
}
