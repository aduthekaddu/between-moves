export type DomainErrorCode =
  | 'unauthenticated'
  | 'authorization_denied'
  | 'conflict'
  | 'move_conflict'
  | 'idempotency_conflict'
  | 'not_found'
  | 'validation_failed';

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

export class AuthenticationRequiredError extends DomainError {
  override readonly name = 'AuthenticationRequiredError';

  constructor(message = 'Authentication is required', options?: ErrorOptions) {
    super('unauthenticated', message, options);
  }
}

export class AuthorizationDeniedError extends DomainError {
  override readonly name = 'AuthorizationDeniedError';

  constructor(message = 'House action is not authorized', options?: ErrorOptions) {
    super('authorization_denied', message, options);
  }
}

/** A transaction that is safe for the application use case to retry in full. */
export class RetryableTransactionError extends DomainError {
  override readonly name = 'RetryableTransactionError';

  constructor(message = 'Transaction must be retried', options?: ErrorOptions) {
    super('conflict', message, options);
  }
}
