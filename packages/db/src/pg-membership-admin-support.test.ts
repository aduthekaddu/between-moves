import { RetryableTransactionError } from '@between-moves/domain';
import { describe, expect, it } from 'vitest';
import { asMembershipAdminTransactionError } from './pg-membership-admin-support';

describe('BM-015 membership administration transaction errors', () => {
  it.each(['40001', '40P01'])('maps PostgreSQL %s to an application-retryable error', (code) => {
    const cause = { code };

    expect(asMembershipAdminTransactionError(cause)).toEqual(
      expect.objectContaining({
        name: 'RetryableTransactionError',
        cause,
      }),
    );
    expect(asMembershipAdminTransactionError(cause)).toBeInstanceOf(RetryableTransactionError);
  });

  it('preserves non-transient failures', () => {
    const error = new Error('constraint failure');

    expect(asMembershipAdminTransactionError(error)).toBe(error);
  });
});
