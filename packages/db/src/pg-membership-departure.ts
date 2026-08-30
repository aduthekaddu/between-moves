import {
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthorizationContext,
  type MembershipLeaveInput,
  type MembershipLeaveResult,
  type MembershipRemovalInput,
  type MembershipRemovalResult,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';
import {
  asMembershipAdminTransactionError,
  parseMembershipRole,
  parseMembershipString,
  rollbackMembershipAdminTransaction,
} from './pg-membership-admin-support';

interface RemovalRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly actor_role: unknown;
  readonly target_role: unknown;
  readonly target_status: unknown;
  readonly target_user_id: unknown;
}

interface LeaveRow extends QueryResultRow {
  readonly membership_id: unknown;
  readonly role: unknown;
  readonly status: unknown;
}

/** [BM-015] [DR-MEM-06] Remove one unprotected active Member and append its audit. */
export async function removeMembershipInPostgres(
  database: Pool,
  context: AuthorizationContext,
  input: MembershipRemovalInput,
): Promise<MembershipRemovalResult> {
  const client = await database.connect();
  try {
    await client.query('begin');
    const found = await client.query<RemovalRow>(
      `select actor.id::text as actor_membership_id,
              actor.role as actor_role,
              target.user_id::text as target_user_id,
              target.role as target_role,
              target.status as target_status
         from houses h
         join memberships actor
           on actor.house_id = h.id
          and actor.user_id = $2
          and actor.status = 'active'
          and actor.role in ('owner', 'steward')
         join memberships target
           on target.house_id = h.id
          and target.id = $3
        where h.id = $1 and h.status = 'active'
        for update of h, actor, target`,
      [context.houseId, context.viewerId, input.targetMembershipId],
    );
    const row = found.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'Membership is unavailable');

    const actorRole = parseMembershipRole(row.actor_role);
    const targetRole = parseMembershipRole(row.target_role);
    if (targetRole === 'owner' || (actorRole === 'steward' && targetRole === 'steward')) {
      throw new HouseAuthorizationDeniedError('protected_member', false);
    }
    if (row.target_status !== 'active') {
      await client.query('commit');
      return {
        membershipId: input.targetMembershipId,
        removedNow: false,
        invalidatedSessionCount: 0,
      };
    }

    const actorMembershipId = parseMembershipString(row.actor_membership_id, 'actor id');
    const targetUserId = parseMembershipString(row.target_user_id, 'target user id');
    const invalidated = await client.query(
      `update sessions
          set revoked_at = $2, updated_at = $2
        where user_id = $1 and revoked_at is null and expires_at > $2
      returning id`,
      [targetUserId, input.removedAt],
    );
    await client.query(
      `update memberships
          set status = 'removed', left_at = $2, updated_at = $2
        where id = $1`,
      [input.targetMembershipId, input.removedAt],
    );
    await client.query(
      `insert into membership_audit
        (id, house_id, actor_membership_id, action, target_membership_id, metadata, created_at)
       values ($1, $2, $3, 'member_removed', $4, $5, $6)`,
      [
        input.auditId,
        context.houseId,
        actorMembershipId,
        input.targetMembershipId,
        { from_role: targetRole },
        input.removedAt,
      ],
    );
    await client.query('commit');
    return {
      membershipId: input.targetMembershipId,
      removedNow: true,
      invalidatedSessionCount: invalidated.rowCount ?? 0,
    };
  } catch (error) {
    await rollbackMembershipAdminTransaction(client);
    throw asMembershipAdminTransactionError(error);
  } finally {
    client.release();
  }
}

/** [BM-015] [DR-MEM-05] Leave a House while holding its Owner guard lock. */
export async function leaveMembershipInPostgres(
  database: Pool,
  context: AuthorizationContext,
  input: MembershipLeaveInput,
): Promise<MembershipLeaveResult> {
  const client = await database.connect();
  try {
    await client.query('begin');
    const found = await client.query<LeaveRow>(
      `select m.id::text as membership_id, m.role, m.status
         from houses h
         join memberships m
           on m.house_id = h.id
          and m.user_id = $2
        where h.id = $1 and h.status = 'active'
        for update of h, m`,
      [context.houseId, context.viewerId],
    );
    const row = found.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'Membership is unavailable');
    const membershipId = parseMembershipString(row.membership_id, 'id');
    if (row.status !== 'active') {
      await client.query('commit');
      return { membershipId, leftNow: false };
    }
    if (parseMembershipRole(row.role) === 'owner') {
      throw new DomainError('validation_failed', 'Transfer ownership before you leave this House.');
    }

    await client.query(
      `update memberships
          set status = 'left', left_at = $2, updated_at = $2
        where id = $1`,
      [membershipId, input.leftAt],
    );
    await client.query(
      `insert into membership_audit
        (id, house_id, actor_membership_id, action, target_membership_id, metadata, created_at)
       values ($1, $2, $3, 'member_left', $3, null, $4)`,
      [input.auditId, context.houseId, membershipId, input.leftAt],
    );
    await client.query('commit');
    return { membershipId, leftNow: true };
  } catch (error) {
    await rollbackMembershipAdminTransaction(client);
    throw asMembershipAdminTransactionError(error);
  } finally {
    client.release();
  }
}
