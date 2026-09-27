import { describe, expect, it } from 'vitest';
import { DomainError } from '../shared/errors';
import { AccountDeletionBlockedError, FORMER_MEMBER_DISPLAY_NAME } from './data-rights';

describe('BM-050 account data rights', () => {
  it('names deleted people with one shared display name', () => {
    expect(FORMER_MEMBER_DISPLAY_NAME).toBe('Former member');
  });

  it('blocks an Owner’s deletion as a conflict that names only their Houses', () => {
    const houses = [{ houseId: '01941f29-7c00-7000-8000-000000000601', name: 'Knights at Dusk' }];
    const error = new AccountDeletionBlockedError(houses);

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('conflict');
    expect(error.name).toBe('AccountDeletionBlockedError');
    expect(error.ownedHouses).toEqual(houses);
  });
});
