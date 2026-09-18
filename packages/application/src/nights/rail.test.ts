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
  presence: [],
  presenceCount: 1,
  activeBoards: [],
  recentResults: [],
};

describe('Night rail read', () => {
  it('[BM-038] authorizes House content before reading the durable rail', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const rails: NightRailRepository = { read: vi.fn(async () => snapshot) };
    const presence = {
      read: vi.fn(async () => ({
        members: [
          {
            clientId: viewer.userId,
            displayName: viewer.displayName,
            signature: 's'.repeat(43),
          },
        ],
      })),
      enter: vi.fn(),
      leave: vi.fn(),
    };

    await expect(
      readNightRail(
        { houseId, nightId, viewer },
        { authorizeHouseAction, clock: { now: () => new Date(0) }, presence, rails },
      ),
    ).resolves.toEqual({
      ...snapshot,
      presence: [
        { clientId: viewer.userId, displayName: viewer.displayName, signature: 's'.repeat(43) },
      ],
    });
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(rails.read).toHaveBeenCalledWith(context, nightId);
    expect(presence.read).toHaveBeenCalledWith(context, nightId, new Date(0));
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
          clock: { now: () => new Date(0) },
          presence: { read: vi.fn() },
          rails: { read },
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(read).not.toHaveBeenCalled();
  });
});
