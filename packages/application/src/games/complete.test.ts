import {
  HouseAuthorizationDeniedError,
  RetryableTransactionError,
  type AuthenticatedViewer,
  type GameCompletionRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { handleDraw, resignGame } from './complete';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000301';
const clientCommandId = '01941f29-7c00-7000-8000-000000000401';
const completedEventId = '01941f29-7c00-7000-8000-000000000501';
const analysisEventId = '01941f29-7c00-7000-8000-000000000502';
const offerEventId = '01941f29-7c00-7000-8000-000000000503';
const completedAt = new Date('2026-09-09T08:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });

function dependencies(repository: Partial<GameCompletionRepository> = {}) {
  const completions: GameCompletionRepository = {
    resign: vi.fn(async () => ({
      gameId,
      houseId,
      state: 'completed' as const,
      result: 'black_win' as const,
      resultReason: 'resign' as const,
      completedAt,
      pendingDrawOffer: null,
      completedNow: true,
      replayed: false,
    })),
    draw: vi.fn(async () => ({
      gameId,
      houseId,
      state: 'active' as const,
      result: null,
      resultReason: null,
      completedAt: null,
      pendingDrawOffer: { offeringMembershipId: 'membership-id', ply: 12 },
      completedNow: false,
      replayed: false,
    })),
    ...repository,
  };
  const ids = [completedEventId, analysisEventId, offerEventId];
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: { now: vi.fn(() => completedAt) },
    ids: { generate: vi.fn(() => ids.shift()!) },
    completions,
  };
}

describe('BM-028 Game completion commands', () => {
  it('[BM-028] [DR-GAME-05] authorizes and submits a resignation with stable event IDs', async () => {
    const deps = dependencies();

    await expect(
      resignGame({ houseId, gameId, clientCommandId, viewer }, deps),
    ).resolves.toMatchObject({ result: 'black_win', completedNow: true });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'create_or_join_game' },
      houseId,
      viewer,
    );
    expect(deps.completions.resign).toHaveBeenCalledWith(context, {
      gameId,
      clientCommandId,
      completedAt,
      completedEventId,
      analysisEventId,
    });
  });

  it('[BM-028] [DR-DRAW-01/02] submits offer and accept through one draw command', async () => {
    const deps = dependencies();

    await handleDraw({ houseId, gameId, clientCommandId, action: 'offer', viewer }, deps);

    expect(deps.completions.draw).toHaveBeenCalledWith(context, {
      gameId,
      clientCommandId,
      action: 'offer',
      completedAt,
      completedEventId,
      analysisEventId,
      offerEventId,
    });
  });

  it('[BM-028] [DR-DRAW-02] passes a decline through the same draw command', async () => {
    const deps = dependencies();

    await handleDraw({ houseId, gameId, clientCommandId, action: 'decline', viewer }, deps);

    expect(deps.completions.draw).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ action: 'decline', offerEventId }),
    );
  });

  it('[BM-028] [DR-SEC-01] denies a non-Member before persistence', async () => {
    const deps = dependencies();
    deps.authorizeHouseAction.mockRejectedValue(
      new HouseAuthorizationDeniedError('not_a_member', true),
    );

    await expect(
      resignGame({ houseId, gameId, clientCommandId, viewer }, deps),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    expect(deps.completions.resign).not.toHaveBeenCalled();
  });

  it('[BM-028] retries transient completion transactions without changing event IDs', async () => {
    const deps = dependencies();
    vi.mocked(deps.completions.resign)
      .mockRejectedValueOnce(new RetryableTransactionError())
      .mockResolvedValueOnce({
        gameId,
        houseId,
        state: 'completed',
        result: 'black_win',
        resultReason: 'resign',
        completedAt,
        pendingDrawOffer: null,
        completedNow: true,
        replayed: false,
      });

    await resignGame({ houseId, gameId, clientCommandId, viewer }, deps);

    expect(deps.completions.resign).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.completions.resign).mock.calls[0]?.[1]).toEqual(
      vi.mocked(deps.completions.resign).mock.calls[1]?.[1],
    );
  });
});
