import type {
  AuthenticatedViewer,
  HouseAction,
  HouseAuthorizationDependencies,
  HouseAuthorizationMembership,
  MembershipRole,
  Viewer,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createAuthorizeHouseAction } from './authorize-house-action';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function membership(role: MembershipRole): HouseAuthorizationMembership {
  return {
    membershipId: '01941f29-7c00-7000-8000-000000000301',
    houseId,
    userId: viewer.userId,
    role,
    status: 'active',
  };
}

const assignedNightId = '01941f29-7c00-7000-8000-000000000401';
const targetMembershipId = '01941f29-7c00-7000-8000-000000000302';

function authorizerFor(
  resolvedMembership: HouseAuthorizationMembership | null,
  resources: {
    readonly assignedNightId: string;
    readonly targetMembership: HouseAuthorizationMembership | null;
  } = {
    assignedNightId,
    targetMembership: { ...membership('member'), membershipId: targetMembershipId },
  },
) {
  const recordDenial = vi.fn();
  const findMembershipById = vi.fn(async () => resources.targetMembership);
  const isAssignedNightHost = vi.fn(
    async (input: { readonly nightId: string }) => input.nightId === resources.assignedNightId,
  );
  const dependencies: HouseAuthorizationDependencies = {
    memberships: {
      findMembership: vi.fn(async () => resolvedMembership),
      findMembershipById,
    },
    nightHosts: { isAssignedNightHost },
    denials: { record: recordDenial },
  };
  return {
    authorizeHouseAction: createAuthorizeHouseAction(dependencies),
    findMembership: dependencies.memberships.findMembership,
    findMembershipById,
    isAssignedNightHost,
    recordDenial,
  };
}

function authorizer(role: MembershipRole) {
  return authorizerFor(membership(role));
}

const actions = [
  { action: { kind: 'view_house_content' }, roles: ['owner', 'steward', 'member'] },
  { action: { kind: 'create_or_join_game' }, roles: ['owner', 'steward', 'member'] },
  {
    action: { kind: 'write_house_chat_or_game_note' },
    roles: ['owner', 'steward', 'member'],
  },
  { action: { kind: 'create_member_invite' }, roles: ['owner', 'steward'] },
  { action: { kind: 'revoke_invite' }, roles: ['owner', 'steward'] },
  { action: { kind: 'draft_or_publish_charter' }, roles: ['owner', 'steward'] },
  { action: { kind: 'schedule_night' }, roles: ['owner', 'steward'] },
  {
    action: { kind: 'start_or_end_assigned_night', nightId: assignedNightId },
    roles: ['owner', 'steward', 'member'],
  },
  { action: { kind: 'remove_member', targetMembershipId }, roles: ['owner', 'steward'] },
  { action: { kind: 'change_permanent_role' }, roles: ['owner'] },
  { action: { kind: 'transfer_ownership' }, roles: ['owner'] },
  { action: { kind: 'delete_house' }, roles: ['owner'] },
] satisfies ReadonlyArray<{
  readonly action: HouseAction;
  readonly roles: readonly MembershipRole[];
}>;

describe('authorizeHouseAction permission matrix', () => {
  for (const row of actions) {
    for (const role of ['owner', 'steward', 'member'] satisfies readonly MembershipRole[]) {
      it(`[BM-012] [DR-PERM-01] ${row.action.kind}: ${role}`, async () => {
        const { authorizeHouseAction, recordDenial } = authorizer(role);
        const allowedRoles: readonly MembershipRole[] = row.roles;

        if (allowedRoles.includes(role)) {
          await expect(authorizeHouseAction(row.action, houseId, viewer)).resolves.toEqual({
            viewerId: viewer.userId,
            houseId,
          });
          expect(recordDenial).not.toHaveBeenCalled();
          return;
        }

        await expect(authorizeHouseAction(row.action, houseId, viewer)).rejects.toMatchObject({
          code: 'authorization_denied',
          reason: 'role_not_permitted',
          crossHouse: false,
        });
        expect(recordDenial).toHaveBeenCalledOnce();
      });
    }
  }

  it('[BM-012] [DR-PERM-02] limits a Member Night host to the assigned Night', async () => {
    const { authorizeHouseAction, isAssignedNightHost } = authorizer('member');
    const otherNightId = '01941f29-7c00-7000-8000-000000000499';

    await expect(
      authorizeHouseAction(
        { kind: 'start_or_end_assigned_night', nightId: otherNightId },
        houseId,
        viewer,
      ),
    ).rejects.toMatchObject({ reason: 'night_host_not_assigned', crossHouse: false });
    expect(isAssignedNightHost).toHaveBeenCalledWith({
      houseId,
      nightId: otherNightId,
      membershipId: membership('member').membershipId,
    });
  });

  it('[BM-012] [DR-PERM-03] prevents a Steward from removing an Owner or Steward', async () => {
    for (const targetRole of ['owner', 'steward'] satisfies readonly MembershipRole[]) {
      const targetMembership = {
        ...membership(targetRole),
        membershipId: targetMembershipId,
        userId: '01941f29-7c00-7000-8000-000000000199',
      };
      const { authorizeHouseAction, findMembershipById } = authorizerFor(membership('steward'), {
        assignedNightId,
        targetMembership,
      });

      await expect(
        authorizeHouseAction({ kind: 'remove_member', targetMembershipId }, houseId, viewer),
      ).rejects.toMatchObject({ reason: 'protected_member', crossHouse: false });
      expect(findMembershipById).toHaveBeenCalledWith({
        houseId,
        membershipId: targetMembershipId,
      });
    }
  });

  it.each([
    ['left', 'inactive_membership'],
    ['removed', 'inactive_membership'],
  ] as const)(
    '[BM-012] [DR-MEM-04] denies a %s membership before role checks',
    async (status, reason) => {
      const { authorizeHouseAction } = authorizerFor({ ...membership('owner'), status });

      await expect(
        authorizeHouseAction({ kind: 'view_house_content' }, houseId, viewer),
      ).rejects.toMatchObject({ reason, crossHouse: false });
    },
  );

  it('[BM-012] denies a viewer who has no membership and flags the other-House scope', async () => {
    const { authorizeHouseAction, findMembership, recordDenial } = authorizerFor(null);

    await expect(
      authorizeHouseAction({ kind: 'view_house_content' }, houseId, viewer),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    expect(findMembership).toHaveBeenCalledWith({ houseId, viewerId: viewer.userId });
    expect(recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'not_a_member', crossHouse: true }),
    );
  });

  it('[BM-012] denies an anonymous viewer without querying House membership', async () => {
    const anonymous = { kind: 'anonymous' } satisfies Viewer;
    const { authorizeHouseAction, findMembership } = authorizerFor(null);

    await expect(
      authorizeHouseAction({ kind: 'view_house_content' }, houseId, anonymous),
    ).rejects.toMatchObject({ reason: 'not_authenticated', crossHouse: false });
    expect(findMembership).not.toHaveBeenCalled();
  });
});
