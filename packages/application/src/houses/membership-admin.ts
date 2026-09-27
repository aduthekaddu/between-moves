import type {
  ChangeMembershipRoleRequest,
  LeaveHouseRequest,
  MembershipAdminDependencies,
  MembershipLeaveResult,
  MembershipRemovalResult,
  MembershipRoleChangeResult,
  RemoveHouseMemberRequest,
  TransferHouseOwnershipRequest,
  OwnershipTransferResult,
} from '@between-moves/domain';
import { retryTransaction } from '../shared/retry-transaction';

/** [BM-015] [DR-PERM-01/03] Change a permanent House role through Owner authority. */
export async function changeMembershipRole(
  request: ChangeMembershipRoleRequest,
  dependencies: MembershipAdminDependencies,
): Promise<MembershipRoleChangeResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'change_permanent_role' },
    request.houseId,
    request.viewer,
  );
  const input = {
    targetMembershipId: request.targetMembershipId,
    role: request.role,
    auditId: dependencies.ids.generate(),
    changedAt: dependencies.clock.now(),
  };
  return retryTransaction(() => dependencies.memberships.changeRole(context, input));
}

/** [BM-015] [DR-MEM-06] Remove a House Member through target-aware authority. */
export async function removeHouseMember(
  request: RemoveHouseMemberRequest,
  dependencies: MembershipAdminDependencies,
): Promise<MembershipRemovalResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'remove_member', targetMembershipId: request.targetMembershipId },
    request.houseId,
    request.viewer,
  );
  const input = {
    targetMembershipId: request.targetMembershipId,
    auditId: dependencies.ids.generate(),
    removedAt: dependencies.clock.now(),
  };
  return retryTransaction(() => dependencies.memberships.remove(context, input));
}

/** [BM-015] [DR-MEM-05] Leave an active House through the transaction's Owner guard. */
export async function leaveHouse(
  request: LeaveHouseRequest,
  dependencies: MembershipAdminDependencies,
): Promise<MembershipLeaveResult> {
  const context = await dependencies.authorizeHouseAction(
    { kind: 'leave_house' },
    request.houseId,
    request.viewer,
  );
  const input = {
    auditId: dependencies.ids.generate(),
    leftAt: dependencies.clock.now(),
  };
  return retryTransaction(() => dependencies.memberships.leave(context, input));
}

/** [BM-015] [DR-HOUSE-02] Transfer a House through the sole-Owner transaction. */
export async function transferHouseOwnership(
  request: TransferHouseOwnershipRequest,
  dependencies: MembershipAdminDependencies,
): Promise<OwnershipTransferResult> {
  const readContext = await dependencies.authorizeHouseAction(
    { kind: 'view_house_content' },
    request.houseId,
    request.viewer,
  );
  const replay = await dependencies.memberships.findOwnershipTransferReplay(readContext, {
    targetMembershipId: request.targetMembershipId,
    idempotencyKey: request.idempotencyKey,
  });
  if (replay !== null) return replay;

  const context = await dependencies.authorizeHouseAction(
    { kind: 'transfer_ownership' },
    request.houseId,
    request.viewer,
  );
  const input = {
    targetMembershipId: request.targetMembershipId,
    idempotencyKey: request.idempotencyKey,
    auditId: dependencies.ids.generate(),
    transferredAt: dependencies.clock.now(),
  };
  return retryTransaction(() => dependencies.memberships.transferOwnership(context, input));
}
