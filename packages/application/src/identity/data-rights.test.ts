import {
  AccountDeletionBlockedError,
  DomainError,
  RetryableTransactionError,
  type AccountDataRightsRepository,
  type AccountExport,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import { FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  createDeleteAccount,
  createExportAccountData,
  createReadAccountSummary,
} from './data-rights';

const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000613',
  displayName: 'Bea',
  imageUrl: null,
};
const now = new Date('2026-10-05T09:00:00.000Z');
const exported: AccountExport = {
  format: 'between-moves.account-export',
  version: 1,
  exportedAt: now.toISOString(),
  profile: {
    userId: viewer.userId,
    displayName: 'Bea',
    email: 'bea@example.test',
    emailVerified: true,
    imageUrl: null,
    createdAt: '2026-08-30T00:00:00.000Z',
  },
  memberships: [],
  authored: { messages: [], notes: [], reactions: [], puzzles: [] },
  games: [],
  moves: [],
  contributions: { points: [], finalStandings: [] },
};

function repository(overrides: Partial<AccountDataRightsRepository> = {}) {
  return {
    readSummary: vi.fn(async () => ({ displayName: 'Bea', houses: [] })),
    exportAccount: vi.fn(async () => exported),
    deleteAccount: vi.fn(async () => ({
      userId: viewer.userId,
      deletedNow: true,
      membershipsLeft: 2,
      sessionsRemoved: 3,
    })),
    ...overrides,
  } satisfies AccountDataRightsRepository;
}

describe('BM-050 account data rights', () => {
  it('reads the summary for the signed-in person only', async () => {
    const accounts = repository();
    await expect(createReadAccountSummary({ accounts })({ viewer })).resolves.toEqual({
      displayName: 'Bea',
      houses: [],
    });
    expect(accounts.readSummary).toHaveBeenCalledWith(viewer.userId);
  });

  it('exports the signed-in person’s own data at the injected time', async () => {
    const accounts = repository();
    const exportAccount = createExportAccountData({ clock: new FakeClock(now), accounts });

    await expect(exportAccount({ viewer })).resolves.toBe(exported);
    expect(accounts.exportAccount).toHaveBeenCalledWith(viewer.userId, now);
  });

  it('reports an identity that is gone as not found', async () => {
    const exportAccount = createExportAccountData({
      clock: new FakeClock(now),
      accounts: repository({ exportAccount: vi.fn(async () => null) }),
    });

    const missing = exportAccount({ viewer });
    await expect(missing).rejects.toBeInstanceOf(DomainError);
    await expect(missing).rejects.toMatchObject({ code: 'not_found' });
  });

  it('deletes the signed-in person’s account with injected time and audit IDs', async () => {
    const accounts = repository();
    const ids = { generate: vi.fn(() => '01941f29-7c00-7000-8000-000000000999') };
    const deleteAccount = createDeleteAccount({ clock: new FakeClock(now), ids, accounts });

    await expect(deleteAccount({ viewer })).resolves.toEqual({
      userId: viewer.userId,
      deletedNow: true,
      membershipsLeft: 2,
      sessionsRemoved: 3,
    });
    expect(accounts.deleteAccount).toHaveBeenCalledWith({
      userId: viewer.userId,
      deletedAt: now,
      auditIds: ids,
    });
  });

  it('retries a serialization conflict with the same deletion instant', async () => {
    const deleteAccount = vi
      .fn<AccountDataRightsRepository['deleteAccount']>()
      .mockRejectedValueOnce(new RetryableTransactionError())
      .mockResolvedValueOnce({
        userId: viewer.userId,
        deletedNow: true,
        membershipsLeft: 0,
        sessionsRemoved: 0,
      });
    const clock = new FakeClock(now);
    await createDeleteAccount({
      clock,
      ids: { generate: () => 'unused' },
      accounts: repository({ deleteAccount }),
    })({ viewer });

    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(deleteAccount.mock.calls.map(([input]) => input.deletedAt)).toEqual([now, now]);
  });

  it('passes an Owner’s blocked deletion through without retrying', async () => {
    const blocked = new AccountDeletionBlockedError([
      { houseId: '01941f29-7c00-7000-8000-000000000601', name: 'Knights at Dusk' },
    ]);
    const deleteAccount = vi.fn(async () => {
      throw blocked;
    });

    await expect(
      createDeleteAccount({
        clock: new FakeClock(now),
        ids: { generate: () => 'unused' },
        accounts: repository({ deleteAccount }),
      })({ viewer }),
    ).rejects.toBe(blocked);
    expect(deleteAccount).toHaveBeenCalledOnce();
  });
});
