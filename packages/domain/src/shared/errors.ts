export type DomainErrorCode =
  'authorization_denied' | 'conflict' | 'not_found' | 'validation_failed';

/** [BM-005] Stable error codes let application seams map failures without string matching. */
export class DomainError extends Error {
  override readonly name: string = 'DomainError';

  constructor(
    readonly code: DomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class AuthorizationDeniedError extends DomainError {
  override readonly name = 'AuthorizationDeniedError';

  constructor(message = 'House action is not authorized', options?: ErrorOptions) {
    super('authorization_denied', message, options);
  }
}
