import { describe, expect, it } from 'vitest';
import { ACCOUNT_DELETION_CONFIRMATION, accountDeletionBodySchema } from './account-data-rights';

describe('BM-050 account deletion contract', () => {
  it('accepts only the exact confirmation phrase', () => {
    expect(
      accountDeletionBodySchema.safeParse({ confirmation: ACCOUNT_DELETION_CONFIRMATION }).success,
    ).toBe(true);
    for (const confirmation of ['Delete my account', 'delete', '', ' delete my account']) {
      expect(accountDeletionBodySchema.safeParse({ confirmation }).success).toBe(false);
    }
  });

  it('rejects a missing confirmation and any account selector', () => {
    expect(accountDeletionBodySchema.safeParse({}).success).toBe(false);
    expect(
      accountDeletionBodySchema.safeParse({
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
        userId: '01941f29-7c00-7000-8000-000000000613',
      }).success,
    ).toBe(false);
  });
});
