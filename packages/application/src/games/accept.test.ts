import {
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type GameSeatAcceptanceRepository,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { acceptGameSeat } from './accept';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000301';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });
const acceptedAt = new Date('2026-09-02T08:00:00.000Z');

function dependencies(repository: Partial<GameSeatAcceptanceRepository> = {}) {
  const acceptances: GameSeatAcceptanceRepository = {
    accept: vi.fn(async () => ({
      gameId,
      houseId,
      whiteMembershipId: '01941f29-7c00-7000-8000-000000000501',
      blackMembershipId: '01941f29-7c00-7000-8000-000000000502',
      moveDueAt: new Date('2026-09-04T08:00:00.000Z'),
      state: 'active' as const,
    })),
    ...repository,
  };
  return {
    authorizeHouseAction: vi.fn(async () => context),
    clock: { now: vi.fn(() => acceptedAt) },
    acceptances,
  };
}

describe('BM-023 Open-seat acceptance', () => {
  it('[BM-023] [DR-SEAT-03] authorizes a Member and delegates one activation transaction', async () => {
    const deps = dependencies();

    await expect(acceptGameSeat({ houseId, gameId, viewer }, deps)).resolves.toMatchObject({
      gameId,
      houseId,
      state: 'active',
    });
    expect(deps.authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'create_or_join_game' },
      houseId,
      viewer,
    );
    expect(deps.acceptances.accept).toHaveBeenCalledWith(context, { gameId, acceptedAt });
  });

  it('[BM-023] denies a non-Member before the acceptance repository runs', async () => {
    const deps = dependencies();
    deps.authorizeHouseAction.mockRejectedValue(
      new HouseAuthorizationDeniedError('not_a_member', true),
    );

    await expect(acceptGameSeat({ houseId, gameId, viewer }, deps)).rejects.toMatchObject({
      code: 'authorization_denied',
      reason: 'not_a_member',
    });
    expect(deps.acceptances.accept).not.toHaveBeenCalled();
  });
});
