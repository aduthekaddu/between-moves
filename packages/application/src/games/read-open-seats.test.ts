import type { AuthenticatedViewer, OpenSeatListing } from '@between-moves/domain';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext, FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { readOpenSeats } from './read-open-seats';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Bea',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ houseId, viewerId: viewer.userId });
const listing: OpenSeatListing = {
  gameId: '01941f29-7c00-7000-8000-000000000501',
  openSeatId: '01941f29-7c00-7000-8000-000000000502',
  mode: 'correspondence',
  clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
  nightId: null,
  offeredColor: 'any',
  creator: { membershipId: '01941f29-7c00-7000-8000-000000000301', name: 'Ada' },
  intended: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  expiresAt: new Date('2026-09-08T00:00:00.000Z'),
  viewerIsCreator: false,
  viewerMayAccept: true,
};

describe('open seat read', () => {
  it('[BM-023] authorizes a House view, then lists seats at the clock instant', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const listOpenSeats = vi.fn(async () => [listing]);
    const clock = new FakeClock(new Date('2026-09-02T10:00:00.000Z'));

    await expect(
      readOpenSeats({ houseId, viewer }, { authorizeHouseAction, seats: { listOpenSeats }, clock }),
    ).resolves.toEqual([listing]);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(listOpenSeats).toHaveBeenCalledWith(context, new Date('2026-09-02T10:00:00.000Z'));
  });

  it('[BM-023] [PR-PLAT-05] never lists seats after a cross-House denial', async () => {
    const listOpenSeats = vi.fn(async () => [listing]);

    await expect(
      readOpenSeats(
        { houseId, viewer },
        {
          authorizeHouseAction: vi.fn(async () => {
            throw new HouseAuthorizationDeniedError('not_a_member', true);
          }),
          seats: { listOpenSeats },
          clock: new FakeClock(new Date('2026-09-02T10:00:00.000Z')),
        },
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(listOpenSeats).not.toHaveBeenCalled();
  });
});
