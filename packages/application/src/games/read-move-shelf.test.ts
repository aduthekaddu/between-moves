import type {
  AuthenticatedViewer,
  MoveShelf,
  MoveShelfReadRepository,
} from '@between-moves/domain';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { readMoveShelf } from './read-move-shelf';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ houseId, viewerId: viewer.userId });
const shelf: MoveShelf = { yourMove: [], waiting: [], recent: [] };

describe('Move Shelf read', () => {
  it('[BM-026] [DR-SHELF-01] authorizes House content before reading the member shelf', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const games: MoveShelfReadRepository = { readMoveShelf: vi.fn(async () => shelf) };

    await expect(
      readMoveShelf({ houseId, viewer }, { authorizeHouseAction, games }),
    ).resolves.toEqual(shelf);

    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(games.readMoveShelf).toHaveBeenCalledWith(context);
  });

  it('[BM-026] [DR-SEC-01] never reads games after a cross-House denial', async () => {
    const read = vi.fn(async () => shelf);

    await expect(
      readMoveShelf(
        { houseId, viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('not_a_member', true);
          }),
          games: { readMoveShelf: read },
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(read).not.toHaveBeenCalled();
  });
});
