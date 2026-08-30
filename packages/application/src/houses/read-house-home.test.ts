import type {
  AuthenticatedViewer,
  HouseHome,
  HouseHomeReadRepository,
} from '@between-moves/domain';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { readHouseHome } from './read-house-home';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({
  houseId,
  viewerId: viewer.userId,
});
const home: HouseHome = {
  houseId,
  name: 'Knights at Dusk',
  description: 'Friendly games every week.',
  emblemSeed: `house:${houseId}`,
  timeZone: 'Asia/Kolkata',
  membershipRole: 'owner',
};

describe('House home read', () => {
  it('[BM-013] [DR-MEM-04] authorizes view access before reading the House home', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const houses: HouseHomeReadRepository = { read: vi.fn(async () => home) };

    await expect(
      readHouseHome(
        { houseId, viewer },
        {
          authorizeHouseAction,
          houses,
        },
      ),
    ).resolves.toEqual(home);

    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(houses.read).toHaveBeenCalledWith(context);
  });

  it('[BM-013] [PR-PLAT-05] never reaches the read repository after cross-House denial', async () => {
    const read = vi.fn(async () => home);

    await expect(
      readHouseHome(
        { houseId, viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('not_a_member', true);
          }),
          houses: { read },
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(read).not.toHaveBeenCalled();
  });
});
