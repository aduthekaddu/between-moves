import type {
  AuthenticatedViewer,
  SeasonClosingInput,
  SeasonClosingRepository,
  SeasonFinalizeInput,
} from '@between-moves/domain';
import { DomainError, HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { closeSeason } from './season-lifecycle';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const eventId = '01941f29-7c00-7000-8000-000000000791';
const actorMembershipId = '01941f29-7c00-7000-8000-000000000202';
const closingAt = new Date('2026-10-02T12:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });
const standings = [
  { membershipId: actorMembershipId, points: 5, rank: 1 },
  { membershipId: '01941f29-7c00-7000-8000-000000000203', points: 0, rank: 2 },
];

function dependencies(repository: Partial<SeasonClosingRepository> = {}) {
  const seasons: SeasonClosingRepository = {
    beginClosing: vi.fn(async (_context, input: SeasonClosingInput) => ({
      seasonId: input.seasonId,
      houseId,
      state: 'closing' as const,
      standings,
      closingNow: true,
      actorMembershipId,
    })),
    finalize: vi.fn(async (_context, input: SeasonFinalizeInput) => ({
      seasonId: input.seasonId,
      houseId,
      state: 'closed' as const,
      closedAt: input.closedAt,
      standings,
      closedNow: true,
      actorMembershipId,
    })),
    ...repository,
  };
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: { now: () => closingAt },
    ids: { generate: vi.fn(() => eventId) },
    seasons,
    transitions: { record: vi.fn() },
  };
}

describe('closeSeason', () => {
  it('[BM-047] moves an active Season through closing to closed with final standings', async () => {
    const deps = dependencies();

    await expect(closeSeason({ houseId, seasonId, viewer }, deps)).resolves.toEqual({
      seasonId,
      houseId,
      state: 'closed',
      closedAt: closingAt,
      standings,
      closedNow: true,
      actorMembershipId,
    });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'close_season' },
      houseId,
      viewer,
    );
    expect(deps.seasons.beginClosing).toHaveBeenCalledWith(context, {
      seasonId,
      closingEventId: eventId,
      closingAt,
    });
    expect(deps.seasons.finalize).toHaveBeenCalledWith(context, { seasonId, closedAt: closingAt });
    expect(vi.mocked(deps.seasons.beginClosing).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.seasons.finalize).mock.invocationCallOrder[0] ?? 0,
    );
    expect(deps.transitions.record.mock.calls.map(([observation]) => observation)).toEqual([
      {
        actorId: viewer.userId,
        houseId,
        seasonId,
        event: 'close_season',
        from: 'active',
        to: 'closing',
        outcome: 'success',
      },
      {
        actorId: viewer.userId,
        houseId,
        seasonId,
        event: 'finalize_season',
        from: 'closing',
        to: 'closed',
        outcome: 'success',
      },
    ]);
  });

  it('[BM-047] denies a Member before any Season state is read', async () => {
    const deps = dependencies();
    deps.authorizeHouseAction.mockRejectedValueOnce(
      new HouseAuthorizationDeniedError('role_not_permitted', false),
    );

    await expect(closeSeason({ houseId, seasonId, viewer }, deps)).rejects.toBeInstanceOf(
      HouseAuthorizationDeniedError,
    );
    expect(deps.seasons.beginClosing).not.toHaveBeenCalled();
    expect(deps.seasons.finalize).not.toHaveBeenCalled();
    expect(deps.transitions.record).not.toHaveBeenCalled();
  });

  it('[BM-047] records a rejected close and never finalizes a non-active Season', async () => {
    const deps = dependencies({
      beginClosing: vi.fn(async () => {
        throw new DomainError('conflict', 'Only an active Season can be closed');
      }),
    });

    await expect(closeSeason({ houseId, seasonId, viewer }, deps)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(deps.seasons.finalize).not.toHaveBeenCalled();
    expect(deps.transitions.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'close_season', outcome: 'rejected' }),
    );
  });

  it('[BM-047] replays a closed Season without logging duplicate transitions', async () => {
    const deps = dependencies({
      beginClosing: vi.fn(async () => ({
        seasonId,
        houseId,
        state: 'closed' as const,
        standings,
        closingNow: false,
        actorMembershipId,
      })),
      finalize: vi.fn(async () => ({
        seasonId,
        houseId,
        state: 'closed' as const,
        closedAt: new Date('2026-10-01T09:00:00.000Z'),
        standings,
        closedNow: false,
        actorMembershipId,
      })),
    });

    await expect(closeSeason({ houseId, seasonId, viewer }, deps)).resolves.toMatchObject({
      state: 'closed',
      closedNow: false,
    });
    expect(deps.transitions.record).not.toHaveBeenCalled();
  });

  it('[BM-047] resumes a Season stranded in closing and records only finalization', async () => {
    const deps = dependencies({
      beginClosing: vi.fn(async () => ({
        seasonId,
        houseId,
        state: 'closing' as const,
        standings,
        closingNow: false,
        actorMembershipId,
      })),
    });

    await expect(closeSeason({ houseId, seasonId, viewer }, deps)).resolves.toMatchObject({
      state: 'closed',
      closedNow: true,
    });
    expect(deps.transitions.record).toHaveBeenCalledTimes(1);
    expect(deps.transitions.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'finalize_season', outcome: 'success' }),
    );
  });

  it('[BM-047] keeps the committed close when transition diagnostics fail', async () => {
    const deps = dependencies();
    deps.transitions.record.mockImplementation(() => {
      throw new Error('log sink unavailable');
    });

    await expect(closeSeason({ houseId, seasonId, viewer }, deps)).resolves.toMatchObject({
      state: 'closed',
    });
  });

  it('[BM-047] reports an unexpected finalization failure as an error outcome', async () => {
    const deps = dependencies({
      finalize: vi.fn(async () => {
        throw new Error('connection reset');
      }),
    });

    await expect(closeSeason({ houseId, seasonId, viewer }, deps)).rejects.toThrow(
      'connection reset',
    );
    expect(deps.transitions.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: 'finalize_season', outcome: 'error' }),
    );
  });
});
