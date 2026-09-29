import type {
  AuthenticatedViewer,
  HouseRoster,
  PendingInvitation,
  PendingInvitationReadRepository,
} from '@between-moves/domain';
import { HouseAuthorizationDeniedError } from '@between-moves/domain';
import { fakeAuthorizationContext, FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { readHouseRoster, readPendingInvitations } from './read-house-roster';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({ houseId, viewerId: viewer.userId });
const roster: HouseRoster = {
  houseId,
  memberCap: 30,
  viewerMembershipId: '01941f29-7c00-7000-8000-000000000301',
  viewerRole: 'owner',
  members: [
    {
      membershipId: '01941f29-7c00-7000-8000-000000000301',
      displayName: 'Ada',
      role: 'owner',
      joinedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  ],
};
const invitation: PendingInvitation = {
  invitationId: '01941f29-7c00-7000-8000-000000000401',
  kind: 'shared',
  intendedEmail: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  expiresAt: new Date('2026-09-08T00:00:00.000Z'),
  useLimit: 5,
  useCount: 0,
  creatorName: 'Ada',
};
const denied = vi.fn(async () => {
  throw new HouseAuthorizationDeniedError('role_not_permitted', false);
});

describe('House roster reads', () => {
  it('[BM-015] authorizes a House view before reading the roster', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const readRoster = vi.fn(async () => roster);

    await expect(
      readHouseRoster({ houseId, viewer }, { authorizeHouseAction, roster: { readRoster } }),
    ).resolves.toEqual(roster);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(readRoster).toHaveBeenCalledWith(context);
  });

  it('[BM-015] [PR-PLAT-05] never reads the roster after a denial', async () => {
    const readRoster = vi.fn(async () => roster);

    await expect(
      readHouseRoster(
        { houseId, viewer },
        { authorizeHouseAction: denied, roster: { readRoster } },
      ),
    ).rejects.toBeInstanceOf(HouseAuthorizationDeniedError);
    expect(readRoster).not.toHaveBeenCalled();
  });

  it('[BM-014] lists pending Invitations at the clock instant for those who may invite', async () => {
    const clock = new FakeClock(new Date('2026-09-02T10:00:00.000Z'));
    const authorizeHouseAction = vi.fn(async () => context);
    const invitations: PendingInvitationReadRepository = {
      listPending: vi.fn(async () => [invitation]),
    };

    await expect(
      readPendingInvitations({ houseId, viewer }, { authorizeHouseAction, invitations, clock }),
    ).resolves.toEqual([invitation]);
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'create_member_invite' },
      houseId,
      viewer,
    );
    expect(invitations.listPending).toHaveBeenCalledWith(
      context,
      new Date('2026-09-02T10:00:00.000Z'),
    );
  });

  it('[BM-014] keeps Invitations from a Member the policy denies', async () => {
    const listPending = vi.fn(async () => [invitation]);

    await expect(
      readPendingInvitations(
        { houseId, viewer },
        {
          authorizeHouseAction: denied,
          invitations: { listPending },
          clock: new FakeClock(new Date('2026-09-02T10:00:00.000Z')),
        },
      ),
    ).rejects.toMatchObject({ reason: 'role_not_permitted' });
    expect(listPending).not.toHaveBeenCalled();
  });
});
