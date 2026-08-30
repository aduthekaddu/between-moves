import {
  DomainError,
  type AuthorizationContext,
  type OwnershipTransferInput,
  type OwnershipTransferReplayQuery,
  type OwnershipTransferResult,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  asMembershipAdminTransactionError,
  parseMembershipString,
  rollbackMembershipAdminTransaction,
} from './pg-membership-admin-support';

interface OwnershipTransferRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly actor_user_id: unknown;
  readonly target_user_id: unknown;
}

interface OwnershipTransferReplayRow extends QueryResultRow {
  readonly previous_owner_membership_id: unknown;
  readonly owner_membership_id: unknown;
}

function parseReplay(
  row: OwnershipTransferReplayRow,
  targetMembershipId: string,
): OwnershipTransferResult {
  const previousOwnerMembershipId = parseMembershipString(
    row.previous_owner_membership_id,
    'previous Owner id',
  );
  const ownerMembershipId = parseMembershipString(row.owner_membership_id, 'Owner id');
  if (ownerMembershipId !== targetMembershipId) {
    throw new DomainError(
      'idempotency_conflict',
      'Idempotency key was reused for another ownership transfer',
    );
  }
  return {
    previousOwnerMembershipId,
    ownerMembershipId,
    changed: false,
    invalidatedSessionCount: 0,
  };
}

async function findReplay(
  database: Pool | PoolClient,
  context: AuthorizationContext,
  query: OwnershipTransferReplayQuery,
): Promise<OwnershipTransferResult | null> {
  const replay = await database.query<OwnershipTransferReplayRow>(
    `select a.metadata->>'previous_owner_membership_id' as previous_owner_membership_id,
            a.metadata->>'owner_membership_id' as owner_membership_id
       from membership_audit a
       join memberships actor on actor.id = a.actor_membership_id
       join memberships viewer
         on viewer.house_id = a.house_id
        and viewer.user_id = $2
        and viewer.status = 'active'
      where a.house_id = $1
        and a.action = 'ownership_transferred'
        and actor.user_id = $2
        and a.metadata->>'idempotency_key_digest' = encode(digest($3, 'sha256'), 'hex')
      limit 1`,
    [context.houseId, context.viewerId, query.idempotencyKey],
  );
  const row = replay.rows[0];
  return row === undefined ? null : parseReplay(row, query.targetMembershipId);
}

export function findOwnershipTransferReplayInPostgres(
  database: Pool,
  context: AuthorizationContext,
  query: OwnershipTransferReplayQuery,
): Promise<OwnershipTransferResult | null> {
  return findReplay(database, context, query);
}

/** [BM-015] [DR-HOUSE-02] Transfer the sole Owner under one House lock. */
export async function transferOwnershipInPostgres(
  database: Pool,
  context: AuthorizationContext,
  input: OwnershipTransferInput,
): Promise<OwnershipTransferResult> {
  const client = await database.connect();
  try {
    await client.query('begin');
    await client.query(
      `select id from houses
        where id = $1 and status = 'active'
        for update`,
      [context.houseId],
    );
    const replay = await findReplay(client, context, {
      targetMembershipId: input.targetMembershipId,
      idempotencyKey: input.idempotencyKey,
    });
    if (replay !== null) {
      await client.query('commit');
      return replay;
    }

    const found = await client.query<OwnershipTransferRow>(
      `select actor.id::text as actor_membership_id,
              actor.user_id::text as actor_user_id,
              target.user_id::text as target_user_id
         from houses h
         join memberships actor
           on actor.id = h.owner_membership_id
          and actor.house_id = h.id
          and actor.user_id = $2
          and actor.role = 'owner'
          and actor.status = 'active'
         join memberships target
           on target.house_id = h.id
          and target.id = $3
          and target.role in ('member', 'steward')
          and target.status = 'active'
        where h.id = $1 and h.status = 'active'
        for update of actor, target`,
      [context.houseId, context.viewerId, input.targetMembershipId],
    );
    const row = found.rows[0];
    if (row === undefined) {
      throw new DomainError('validation_failed', 'Transfer target is invalid');
    }

    const previousOwnerMembershipId = parseMembershipString(row.actor_membership_id, 'Owner id');
    const actorUserId = parseMembershipString(row.actor_user_id, 'Owner user id');
    const targetUserId = parseMembershipString(row.target_user_id, 'target user id');
    await client.query(`update memberships set role = 'member', updated_at = $2 where id = $1`, [
      previousOwnerMembershipId,
      input.transferredAt,
    ]);
    await client.query(`update memberships set role = 'owner', updated_at = $2 where id = $1`, [
      input.targetMembershipId,
      input.transferredAt,
    ]);
    await client.query(
      `update houses set owner_membership_id = $2, updated_at = $3 where id = $1`,
      [context.houseId, input.targetMembershipId, input.transferredAt],
    );
    const invalidated = await client.query(
      `update sessions
          set revoked_at = $3, updated_at = $3
        where user_id in ($1, $2) and revoked_at is null and expires_at > $3
      returning id`,
      [actorUserId, targetUserId, input.transferredAt],
    );
    await client.query(
      `insert into membership_audit
        (id, house_id, actor_membership_id, action, target_membership_id, metadata, created_at)
       values ($1, $2, $3, 'ownership_transferred', $4,
               jsonb_build_object(
                 'previous_owner_membership_id', $3::text,
                 'owner_membership_id', $4::text,
                 'idempotency_key_digest', encode(digest($5, 'sha256'), 'hex')
               ), $6)`,
      [
        input.auditId,
        context.houseId,
        previousOwnerMembershipId,
        input.targetMembershipId,
        input.idempotencyKey,
        input.transferredAt,
      ],
    );
    await client.query('commit');
    return {
      previousOwnerMembershipId,
      ownerMembershipId: input.targetMembershipId,
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
