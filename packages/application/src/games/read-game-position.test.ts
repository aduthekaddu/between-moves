import type {
  AuthenticatedViewer,
  GamePosition,
  GamePositionReadRepository,
} from '@between-moves/domain';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { readGamePosition } from './read-game-position';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const gameId = '01941f29-7c00-7000-8000-000000000202';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ houseId, viewerId: viewer.userId });
const position: GamePosition = {
  gameId,
  mode: 'correspondence',
  state: 'active',
  currentFen: '8/8/8/8/8/8/8/8 w - - 0 1',
  currentPly: 0,
  sideToMove: 'white',
  version: 0,
  white: { membershipId: 'white', name: 'Ada' },
  black: { membershipId: 'black', name: 'Bea' },
  viewerColor: 'white',
  canMove: true,
  moveDueAt: new Date('2026-09-10T08:00:00.000Z'),
  result: null,
  resultReason: null,
  inCheck: false,
  moves: [],
  pendingDrawOffer: null,
  drawOfferDeclined: false,
  headToHead: { whiteWins: 0, blackWins: 0, draws: 0 },
};

describe('Game position read', () => {
  it('[BM-027] [DR-MOVE-01] authorizes House content before reading the canonical position', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const games: GamePositionReadRepository = {
      readGamePosition: vi.fn(async () => position),
    };

    await expect(
      readGamePosition({ houseId, gameId, viewer }, { authorizeHouseAction, games }),
    ).resolves.toEqual(position);

    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(games.readGamePosition).toHaveBeenCalledWith(context, gameId);
  });

  it('[BM-027] [DR-SEC-01] never reads a Game after a cross-House denial', async () => {
    const read = vi.fn(async () => position);

    await expect(
      readGamePosition(
        { houseId, gameId, viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('not_a_member', true);
          }),
          games: { readGamePosition: read },
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(read).not.toHaveBeenCalled();
  });
});
