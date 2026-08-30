import {
  DomainError,
  type AuthorizationContext,
  type MembershipRoleChangeInput,
  type MembershipRoleChangeResult,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';
import {
  asMembershipAdminTransactionError,
  parseMembershipString,
  parsePermanentMembershipRole,
  rollbackMembershipAdminTransaction,
} from './pg-membership-admin-support';

interface RoleChangeRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly target_user_id: unknown;
  readonly target_role: unknown;
}

/** [BM-015] [DR-ID-02] Commit a role, audit, and prior-session invalidation together. */
export async function changeMembershipRoleInPostgres(
  database: Pool,
  context: AuthorizationContext,
  input: MembershipRoleChangeInput,
): Promise<MembershipRoleChangeResult> {
  const client = await database.connect();
  try {
    await client.query('begin');
    const found = await client.query<RoleChangeRow>(
      `select actor.id::text as actor_membership_id,
              target.user_id::text as target_user_id,
              target.role as target_role
         from houses h
         join memberships actor
           on actor.house_id = h.id
          and actor.user_id = $2
          and actor.status = 'active'
          and actor.role = 'owner'
         join memberships target
           on target.house_id = h.id
          and target.id = $3
          and target.status = 'active'
          and target.role in ('member', 'steward')
        where h.id = $1 and h.status = 'active'
        for update of h, actor, target`,
      [context.houseId, context.viewerId, input.targetMembershipId],
    );
    const row = found.rows[0];
    if (row === undefined) throw new DomainError('not_found', 'Membership is unavailable');

    const actorMembershipId = parseMembershipString(row.actor_membership_id, 'actor id');
    const targetUserId = parseMembershipString(row.target_user_id, 'target user id');
    const previousRole = parsePermanentMembershipRole(row.target_role);
    if (previousRole === input.role) {
      await client.query('commit');
      return {
        membershipId: input.targetMembershipId,
        role: input.role,
        changed: false,
        invalidatedSessionCount: 0,
      };
    }

    await client.query(
      `update memberships
          set role = $2, updated_at = $3
        where id = $1`,
      [input.targetMembershipId, input.role, input.changedAt],
    );
    const invalidated = await client.query(
      `update sessions
          set revoked_at = $2, updated_at = $2
        where user_id = $1 and revoked_at is null and expires_at > $2
      returning id`,
      [targetUserId, input.changedAt],
    );
    await client.query(
      `insert into membership_audit
        (id, house_id, actor_membership_id, action, target_membership_id, metadata, created_at)
       values ($1, $2, $3, 'role_changed', $4, $5, $6)`,
      [
        input.auditId,
        context.houseId,
        actorMembershipId,
        input.targetMembershipId,
        { from_role: previousRole, to_role: input.role },
        input.changedAt,
      ],
    );
    await client.query('commit');
    return {
      membershipId: input.targetMembershipId,
      role: input.role,
      changed: true,
      invalidatedSessionCount: invalidated.rowCount ?? 0,
    };
  } catch (error) {
    await rollbackMembershipAdminTransaction(client);
    throw asMembershipAdminTransactionError(error);
  } finally {
    client.release();
  }
}
