import { RetryableTransactionError } from '@between-moves/domain';

const MAXIMUM_TRANSACTION_ATTEMPTS = 3;

export const retryTransaction = async <T>(operation: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof RetryableTransactionError) ||
        attempt >= MAXIMUM_TRANSACTION_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
};
