import type { AuthenticatedViewer, GameSeatCancellationResult } from '@between-moves/domain';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext, FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { cancelGameSeat } from './cancel-seat';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000501';
const cancelledAt = new Date('2026-09-02T10:00:00.000Z');
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ houseId, viewerId: viewer.userId });
const cancelled: GameSeatCancellationResult = {
  gameId,
  houseId,
  cancelledBy: 'creator',
  state: 'cancelled',
  cancelledNow: true,
};

describe('Open seat cancellation', () => {
  it('[BM-022] authorizes a House Member, then cancels at server time', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const cancel = vi.fn(async () => cancelled);

    await expect(
      cancelGameSeat(
        { houseId, gameId, viewer },
        {
          authorizeHouseAction,
          clock: new FakeClock(cancelledAt),
          cancellations: { cancel },
        },
      ),
    ).resolves.toEqual(cancelled);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'create_or_join_game' },
      houseId,
      viewer,
    );
    expect(cancel).toHaveBeenCalledWith(context, { gameId, cancelledAt });
  });

  it('[BM-022] [PR-PLAT-05] never reaches the seat after a cross-House denial', async () => {
    const cancel = vi.fn(async () => cancelled);

    await expect(
      cancelGameSeat(
        { houseId, gameId, viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('not_a_member', true);
          }),
          clock: new FakeClock(cancelledAt),
          cancellations: { cancel },
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member' });
    expect(cancel).not.toHaveBeenCalled();
  });
});
