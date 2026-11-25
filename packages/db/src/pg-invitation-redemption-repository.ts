import {
  InvitationRedemptionError,
  type InvitationRedemptionInput,
  type InvitationRedemptionRepository,
  type InvitationRedemptionResult,
  type MembershipStatus,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface InvitationRow extends QueryResultRow {
  readonly invitation_id: unknown;
  readonly house_id: unknown;
  readonly intended_email: unknown;
  readonly user_email: unknown;
  readonly expires_at: unknown;
  readonly use_count: unknown;
  readonly use_limit: unknown;
  readonly revoked_at: unknown;
}

interface HouseRow extends QueryResultRow {
  readonly member_cap: unknown;
}

interface MembershipRow extends QueryResultRow {
  readonly membership_id: unknown;
  readonly status: unknown;
  readonly replay_reactivated: unknown;
}

function parseInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid Invitation ${field}`);
  }
  return value;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Invitation ${field}`);
  return value;
}

function parseDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid Invitation ${field}`);
  }
  return value;
}

function parseOptionalEmail(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value;
  throw new Error('Invalid Invitation intended email');
}

function parseReplay(value: unknown): boolean | null {
  if (value === null) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Invalid Invitation replay state');
}

function parseMembershipStatus(value: unknown): MembershipStatus {
  if (value === 'active' || value === 'left' || value === 'removed') return value;
  throw new Error('Invalid membership status');
}

async function lockInvitation(
  client: PoolClient,
  input: InvitationRedemptionInput,
): Promise<InvitationRow> {
  const result = await client.query<InvitationRow>(
    `select i.id::text as invitation_id, i.house_id::text, i.intended_email::text,
            i.expires_at, i.use_count, i.use_limit, i.revoked_at,
            u.email::text as user_email
       from invitations i
       join users u on u.id = $2 and u.status = 'active'
      where i.token_digest = decode($1, 'hex')
      for update of i`,
    [input.tokenDigestHex, input.userId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new InvitationRedemptionError('invalid');
  return row;
}

async function lockHouse(client: PoolClient, houseId: string): Promise<number> {
  const result = await client.query<HouseRow>(
    `select member_cap
       from houses
      where id = $1 and status = 'active'
      for update`,
    [houseId],
  );
  if (result.rows[0] === undefined) throw new InvitationRedemptionError('invalid');
  return parseInteger(result.rows[0].member_cap, 'member cap');
}

async function findMembership(
  client: PoolClient,
  houseId: string,
  userId: string,
  invitationId: string,
): Promise<MembershipRow | null> {
  const result = await client.query<MembershipRow>(
    `select m.id::text as membership_id, m.status,
            a.metadata->>'reactivated' as replay_reactivated
       from memberships m
       left join lateral (
         select metadata
           from membership_audit
          where target_membership_id = m.id
            and action = 'member_joined'
            and metadata->>'invitation_id' = $3
          order by created_at asc
          limit 1
       ) a on true
      where m.house_id = $1 and m.user_id = $2`,
    [houseId, userId, invitationId],
  );
  return result.rows[0] ?? null;
}

function validateInvitation(row: InvitationRow, redeemedAt: Date): void {
  if (row.revoked_at !== null) throw new InvitationRedemptionError('invalid');
  if (redeemedAt >= parseDate(row.expires_at, 'expiry')) {
    throw new InvitationRedemptionError('invalid');
  }
  const intendedEmail = parseOptionalEmail(row.intended_email);
  const userEmail = parseString(row.user_email, 'user email');
  if (intendedEmail !== null && intendedEmail.toLowerCase() !== userEmail.toLowerCase()) {
    throw new InvitationRedemptionError('invalid');
  }
  if (parseInteger(row.use_count, 'use count') >= parseInteger(row.use_limit, 'use limit')) {
    throw new InvitationRedemptionError('invalid');
  }
}

async function activeMemberCount(client: PoolClient, houseId: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `select count(*)::integer as count
       from memberships
      where house_id = $1 and status = 'active'`,
    [houseId],
  );
  return parseInteger(result.rows[0]?.count, 'active member count');
}

/** [BM-016] [DR-INVITE-07..11] Serialized, capacity-safe Invitation redemption. */
export class PgInvitationRedemptionRepository implements InvitationRedemptionRepository {
  constructor(private readonly database: Pool) {}

  async redeem(input: InvitationRedemptionInput): Promise<InvitationRedemptionResult> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const invitation = await lockInvitation(client, input);
      const invitationId = parseString(invitation.invitation_id, 'id');
      const houseId = parseString(invitation.house_id, 'House id');
      const inviteKind =
        parseOptionalEmail(invitation.intended_email) === null ? 'shared' : 'email';
      const memberCap = await lockHouse(client, houseId);
      const membership = await findMembership(client, houseId, input.userId, invitationId);
      const membershipStatus =
        membership === null ? null : parseMembershipStatus(membership.status);
      const replay = parseReplay(membership?.replay_reactivated ?? null);
      if (membership !== null && membershipStatus === 'active' && replay !== null) {
        await client.query('commit');
        return {
          houseId,
          membershipId: parseString(membership.membership_id, 'membership id'),
          inviteKind,
          reactivated: replay,
        };
      }

      validateInvitation(invitation, input.redeemedAt);
      if (membership !== null && membershipStatus === 'active') {
        await client.query('commit');
        return {
          houseId,
          membershipId: parseString(membership.membership_id, 'membership id'),
          inviteKind,
          reactivated: false,
        };
      }
      if ((await activeMemberCount(client, houseId)) >= memberCap) {
        throw new InvitationRedemptionError('house_full');
      }

      const reactivated = membership !== null;
      const membershipId =
        membership === null
          ? input.membershipId
          : parseString(membership.membership_id, 'membership id');
      if (membership === null) {
        await client.query(
          `insert into memberships
            (id, house_id, user_id, role, status, joined_at, left_at, created_at, updated_at)
           values ($1, $2, $3, 'member', 'active', $4, null, $4, $4)`,
          [membershipId, houseId, input.userId, input.redeemedAt],
        );
      } else {
        await client.query(
          `update memberships
              set role = 'member', status = 'active', joined_at = $2,
                  left_at = null, updated_at = $2
            where id = $1`,
          [membershipId, input.redeemedAt],
        );
      }

      await client.query('update invitations set use_count = use_count + 1 where id = $1', [
        invitationId,
      ]);
      await client.query(
        `insert into membership_audit
          (id, house_id, actor_membership_id, action, target_membership_id, metadata, created_at)
         values ($1, $2, $3, 'member_joined', $3, $4, $5)`,
        [
          input.auditId,
          houseId,
          membershipId,
          { invitation_id: invitationId, reactivated },
          input.redeemedAt,
        ],
      );
      await client.query('commit');
      return { houseId, membershipId, inviteKind, reactivated };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
