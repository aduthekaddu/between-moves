import type {
  AuthorizationContext,
  MembershipAdminRepository,
  MembershipLeaveInput,
  MembershipLeaveResult,
  MembershipRemovalInput,
  MembershipRemovalResult,
  MembershipRoleChangeInput,
  MembershipRoleChangeResult,
  OwnershipTransferInput,
  OwnershipTransferReplayQuery,
  OwnershipTransferResult,
} from '@between-moves/domain';
import type { Pool } from 'pg';
import { leaveMembershipInPostgres, removeMembershipInPostgres } from './pg-membership-departure';
import { changeMembershipRoleInPostgres } from './pg-membership-role-change';
import {
  findOwnershipTransferReplayInPostgres,
  transferOwnershipInPostgres,
} from './pg-ownership-transfer';

/** [BM-015] PostgreSQL adapter for the atomic membership administration port. */
export class PgMembershipAdminRepository implements MembershipAdminRepository {
  constructor(private readonly database: Pool) {}

  findOwnershipTransferReplay(
    context: AuthorizationContext,
    query: OwnershipTransferReplayQuery,
  ): Promise<OwnershipTransferResult | null> {
    return findOwnershipTransferReplayInPostgres(this.database, context, query);
  }

  changeRole(
    context: AuthorizationContext,
    input: MembershipRoleChangeInput,
  ): Promise<MembershipRoleChangeResult> {
    return changeMembershipRoleInPostgres(this.database, context, input);
  }

  remove(
    context: AuthorizationContext,
    input: MembershipRemovalInput,
  ): Promise<MembershipRemovalResult> {
    return removeMembershipInPostgres(this.database, context, input);
  }

  leave(
    context: AuthorizationContext,
    input: MembershipLeaveInput,
  ): Promise<MembershipLeaveResult> {
    return leaveMembershipInPostgres(this.database, context, input);
  }

  transferOwnership(
    context: AuthorizationContext,
    input: OwnershipTransferInput,
  ): Promise<OwnershipTransferResult> {
    return transferOwnershipInPostgres(this.database, context, input);
  }
}
