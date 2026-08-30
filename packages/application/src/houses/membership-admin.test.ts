import type {
  AuthenticatedViewer,
  MembershipAdminRepository,
  MembershipRoleChangeInput,
} from '@between-moves/domain';
import { RetryableTransactionError } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  changeMembershipRole,
  leaveHouse,
  removeHouseMember,
  transferHouseOwnership,
} from './membership-admin';

const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const houseId = '01941f29-7c00-7000-8000-000000000201';
const targetMembershipId = '01941f29-7c00-7000-8000-000000000202';
const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });

describe('membership administration', () => {
  it('[BM-015] [DR-PERM-01/03] authorizes and timestamps an owner role change', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const changeRole = vi.fn(
      async (_context: typeof context, input: MembershipRoleChangeInput) => ({
        membershipId: input.targetMembershipId,
        role: input.role,
        changed: true,
        invalidatedSessionCount: 2,
      }),
    );
    const memberships: MembershipAdminRepository = {
      findOwnershipTransferReplay: vi.fn(async () => null),
      changeRole,
      remove: vi.fn(),
      leave: vi.fn(),
      transferOwnership: vi.fn(),
    };

    await expect(
      changeMembershipRole(
        { houseId, targetMembershipId, role: 'steward', viewer },
        {
          authorizeHouseAction,
          clock: { now: () => new Date('2026-08-30T16:00:00.000Z') },
          ids: { generate: () => '01941f29-7c00-7000-8000-000000000301' },
          memberships,
        },
      ),
    ).resolves.toEqual({
      membershipId: targetMembershipId,
      role: 'steward',
      changed: true,
      invalidatedSessionCount: 2,
    });
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'change_permanent_role' },
      houseId,
      viewer,
    );
    expect(changeRole).toHaveBeenCalledWith(context, {
      targetMembershipId,
      role: 'steward',
      auditId: '01941f29-7c00-7000-8000-000000000301',
      changedAt: new Date('2026-08-30T16:00:00.000Z'),
    });
  });

  it('[BM-015] [DR-MEM-06] authorizes removal against the protected target', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const remove = vi.fn(async () => ({
      membershipId: targetMembershipId,
      removedNow: true,
      invalidatedSessionCount: 2,
    }));
    const memberships: MembershipAdminRepository = {
      findOwnershipTransferReplay: vi.fn(async () => null),
      changeRole: vi.fn(),
      remove,
      leave: vi.fn(),
      transferOwnership: vi.fn(),
    };

    await expect(
      removeHouseMember(
        { houseId, targetMembershipId, viewer },
        {
          authorizeHouseAction,
          clock: { now: () => new Date('2026-08-30T16:10:00.000Z') },
          ids: { generate: () => '01941f29-7c00-7000-8000-000000000302' },
          memberships,
        },
      ),
    ).resolves.toEqual({
      membershipId: targetMembershipId,
      removedNow: true,
      invalidatedSessionCount: 2,
    });
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'remove_member', targetMembershipId },
      houseId,
      viewer,
    );
    expect(remove).toHaveBeenCalledWith(context, {
      targetMembershipId,
      auditId: '01941f29-7c00-7000-8000-000000000302',
      removedAt: new Date('2026-08-30T16:10:00.000Z'),
    });
  });

  it('[BM-015] [DR-MEM-05] sends an authorized leave command to the owner-guarded transaction', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const leave = vi.fn(async () => ({ membershipId: targetMembershipId, leftNow: true }));
    const memberships: MembershipAdminRepository = {
      findOwnershipTransferReplay: vi.fn(async () => null),
      changeRole: vi.fn(),
      remove: vi.fn(),
      leave,
      transferOwnership: vi.fn(),
    };

    await expect(
      leaveHouse(
        { houseId, viewer },
        {
          authorizeHouseAction,
          clock: { now: () => new Date('2026-08-30T16:20:00.000Z') },
          ids: { generate: () => '01941f29-7c00-7000-8000-000000000303' },
          memberships,
        },
      ),
    ).resolves.toEqual({ membershipId: targetMembershipId, leftNow: true });
    expect(authorizeHouseAction).toHaveBeenCalledWith({ kind: 'leave_house' }, houseId, viewer);
    expect(leave).toHaveBeenCalledWith(context, {
      auditId: '01941f29-7c00-7000-8000-000000000303',
      leftAt: new Date('2026-08-30T16:20:00.000Z'),
    });
  });

  it('[BM-015] [DR-HOUSE-02] authorizes and timestamps ownership transfer', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const transferOwnership = vi.fn(async () => ({
      previousOwnerMembershipId: '01941f29-7c00-7000-8000-000000000203',
      ownerMembershipId: targetMembershipId,
      changed: true,
      invalidatedSessionCount: 3,
    }));
    const memberships: MembershipAdminRepository = {
      findOwnershipTransferReplay: vi.fn(async () => null),
      changeRole: vi.fn(),
      remove: vi.fn(),
      leave: vi.fn(),
      transferOwnership,
    };

    await expect(
      transferHouseOwnership(
        {
          houseId,
          targetMembershipId,
          idempotencyKey: 'transfer-request-1',
          viewer,
        },
        {
          authorizeHouseAction,
          clock: { now: () => new Date('2026-08-30T16:30:00.000Z') },
          ids: { generate: () => '01941f29-7c00-7000-8000-000000000304' },
          memberships,
        },
      ),
    ).resolves.toEqual({
      previousOwnerMembershipId: '01941f29-7c00-7000-8000-000000000203',
      ownerMembershipId: targetMembershipId,
      changed: true,
      invalidatedSessionCount: 3,
    });
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'transfer_ownership' },
      houseId,
      viewer,
    );
    expect(transferOwnership).toHaveBeenCalledWith(context, {
      targetMembershipId,
      idempotencyKey: 'transfer-request-1',
      auditId: '01941f29-7c00-7000-8000-000000000304',
      transferredAt: new Date('2026-08-30T16:30:00.000Z'),
    });
  });

  it('[BM-015] returns an ownership transfer retry before the former Owner is re-authorized', async () => {
    const replay = {
      previousOwnerMembershipId: '01941f29-7c00-7000-8000-000000000203',
      ownerMembershipId: targetMembershipId,
      changed: false,
      invalidatedSessionCount: 0,
    };
    const findOwnershipTransferReplay = vi.fn(async () => replay);
    const authorizeHouseAction = vi.fn(async () => context);
    const memberships: MembershipAdminRepository = {
      findOwnershipTransferReplay,
      changeRole: vi.fn(),
      remove: vi.fn(),
      leave: vi.fn(),
      transferOwnership: vi.fn(),
    };

    await expect(
      transferHouseOwnership(
        {
          houseId,
          targetMembershipId,
          idempotencyKey: 'transfer-request-1',
          viewer,
        },
        {
          authorizeHouseAction,
          clock: { now: () => new Date('2026-08-30T16:31:00.000Z') },
          ids: { generate: vi.fn() },
          memberships,
        },
      ),
    ).resolves.toEqual(replay);
    expect(findOwnershipTransferReplay).toHaveBeenCalledWith(context, {
      targetMembershipId,
      idempotencyKey: 'transfer-request-1',
    });
    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'view_house_content' },
      houseId,
      viewer,
    );
    expect(memberships.transferOwnership).not.toHaveBeenCalled();
  });

  it('[BM-015] retries a transient transaction failure with the original command input', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const changeRole = vi
      .fn()
      .mockRejectedValueOnce(new RetryableTransactionError())
      .mockResolvedValue({
        membershipId: targetMembershipId,
        role: 'steward',
        changed: true,
        invalidatedSessionCount: 1,
      });
    const memberships: MembershipAdminRepository = {
      findOwnershipTransferReplay: vi.fn(async () => null),
      changeRole,
      remove: vi.fn(),
      leave: vi.fn(),
      transferOwnership: vi.fn(),
    };

    await expect(
      changeMembershipRole(
        { houseId, targetMembershipId, role: 'steward', viewer },
        {
          authorizeHouseAction,
          clock: { now: () => new Date('2026-08-30T16:40:00.000Z') },
          ids: { generate: () => '01941f29-7c00-7000-8000-000000000305' },
          memberships,
        },
      ),
    ).resolves.toMatchObject({ changed: true });
    expect(changeRole).toHaveBeenCalledTimes(2);
    expect(changeRole.mock.calls[0]).toEqual(changeRole.mock.calls[1]);
  });
});
