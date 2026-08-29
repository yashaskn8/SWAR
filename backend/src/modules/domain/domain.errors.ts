export class IllegalDomainTransitionError extends Error {
  readonly code = 'ILLEGAL_DOMAIN_TRANSITION';

  constructor(aggregate: string, from: string, to: string) {
    super(`${aggregate} cannot transition from ${from} to ${to}.`);
    this.name = 'IllegalDomainTransitionError';
  }
}

export class DomainProviderError extends Error {
  readonly code = 'DOMAIN_PROVIDER_FAILED';

  constructor(
    readonly provider: 'LIVEKIT' | 'ML' | 'PROTECTED_ACTION' | 'SECURITY_EVENT',
    readonly operation: string,
    readonly recoverableState: string,
  ) {
    super(`${provider} ${operation} failed; state is ${recoverableState}.`);
    this.name = 'DomainProviderError';
  }
}

export class DomainInputError extends Error {
  readonly code = 'DOMAIN_INPUT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'DomainInputError';
  }
}
