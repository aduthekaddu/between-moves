import {
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type NightRailRepository,
  type NightRailSnapshot,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { readNightRail } from './rail';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });
const snapshot: NightRailSnapshot = {
  houseId,
  nightId,
  seasonId: '01941f29-7c00-7000-8000-000000000701',
  state: 'live',
  scheduledStart: new Date('2026-09-04T14:00:00.000Z'),
  scheduledEnd: new Date('2026-09-04T16:00:00.000Z'),
  startedAt: new Date('2026-09-04T14:00:00.000Z'),
  endedAt: null,
  nightSequence: 1n,
  presenceCount: 1,
  activeBoards: [],
  recentResults: [],
};

describe('Night rail read', () => {
  it('[BM-038] authorizes House content before reading the durable rail', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const rails: NightRailRepository = { read: vi.fn(async () => snapshot) };

    await expect(
      readNightRail({ houseId, nightId, viewer }, { authorizeHouseAction, rails }),
    ).resolves.toEqual(snapshot);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(rails.read).toHaveBeenCalledWith(context, nightId);
  });

  it('[BM-038] [DR-SEC-01] never reads another House Night after a denial', async () => {
    const read = vi.fn(async () => snapshot);

    await expect(
      readNightRail(
        { houseId, nightId, viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('not_a_member', true);
          }),
          rails: { read },
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(read).not.toHaveBeenCalled();
  });
});
