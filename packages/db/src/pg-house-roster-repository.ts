import type {
  AuthorizationContext,
  HouseRoster,
  HouseRosterMember,
  HouseRosterReadRepository,
  MembershipRole,
  PendingInvitation,
  PendingInvitationReadRepository,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface RosterRow extends QueryResultRow {
  readonly member_cap: unknown;
  readonly viewer_membership_id: unknown;
  readonly viewer_role: unknown;
  readonly membership_id: unknown;
  readonly display_name: unknown;
  readonly role: unknown;
  readonly joined_at: unknown;
}

interface PendingInvitationRow extends QueryResultRow {
  readonly invitation_id: unknown;
  readonly intended_email: unknown;
  readonly created_at: unknown;
  readonly expires_at: unknown;
  readonly use_limit: unknown;
  readonly use_count: unknown;
  readonly creator_name: unknown;
}

const PENDING_INVITATION_LIMIT = 50;

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid House roster ${field}`);
  return value;
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid House roster ${field}`);
  }
  return value;
}

function instant(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid House roster ${field}`);
  }
  return value;
}

function role(value: unknown): MembershipRole {
  if (value === 'owner' || value === 'steward' || value === 'member') return value;
  throw new Error('Invalid House roster role');
}

function rosterMember(row: RosterRow): HouseRosterMember {
  return {
    membershipId: text(row.membership_id, 'membership id'),
    displayName: text(row.display_name, 'display name'),
    role: role(row.role),
    joinedAt: instant(row.joined_at, 'join time'),
  };
}

function pendingInvitation(row: PendingInvitationRow): PendingInvitation {
  const intendedEmail =
    row.intended_email === null ? null : text(row.intended_email, 'intended email');
  return {
    invitationId: text(row.invitation_id, 'Invitation id'),
    kind: intendedEmail === null ? 'shared' : 'single',
    intendedEmail,
    createdAt: instant(row.created_at, 'Invitation creation time'),
    expiresAt: instant(row.expires_at, 'Invitation expiry'),
    useLimit: count(row.use_limit, 'Invitation use limit'),
    useCount: count(row.use_count, 'Invitation use count'),
    creatorName: text(row.creator_name, 'Invitation creator'),
  };
}

/**
 * [BM-014] [BM-015] [DR-MEM-04] House roster and Invitation reads behind House, viewer, and
 * active-membership predicates. A stale context for a Member who has since left reads nothing.
 */
export class PgHouseRosterRepository
  implements HouseRosterReadRepository, PendingInvitationReadRepository
{
  constructor(private readonly database: Pool) {}

  async readRoster(context: AuthorizationContext): Promise<HouseRoster | null> {
    const result = await this.database.query<RosterRow>(
      `select h.member_cap,
              viewer.id::text as viewer_membership_id,
              viewer.role as viewer_role,
              m.id::text as membership_id,
              coalesce(m.display_name_snapshot, u.display_name) as display_name,
              m.role,
              m.joined_at
         from houses h
         join memberships viewer
           on viewer.house_id = h.id and viewer.user_id = $2 and viewer.status = 'active'
         join memberships m on m.house_id = h.id and m.status = 'active'
         join users u on u.id = m.user_id
        where h.id = $1 and h.status = 'active'
        order by case m.role when 'owner' then 0 when 'steward' then 1 else 2 end,
                 lower(coalesce(m.display_name_snapshot, u.display_name)),
                 m.joined_at,
                 m.id`,
      [context.houseId, context.viewerId],
    );
    const first = result.rows[0];
    if (first === undefined) return null;
    return {
      houseId: context.houseId,
      memberCap: count(first.member_cap, 'member cap'),
      viewerMembershipId: text(first.viewer_membership_id, 'viewer membership id'),
      viewerRole: role(first.viewer_role),
      members: result.rows.map(rosterMember),
    };
  }

  async listPending(
    context: AuthorizationContext,
    now: Date,
  ): Promise<readonly PendingInvitation[]> {
    const result = await this.database.query<PendingInvitationRow>(
      `select i.id::text as invitation_id,
              i.intended_email::text as intended_email,
              i.created_at,
              i.expires_at,
              i.use_limit,
              i.use_count,
              coalesce(creator.display_name_snapshot, creator_user.display_name) as creator_name
         from invitations i
         join houses h on h.id = i.house_id and h.status = 'active'
         join memberships viewer
           on viewer.house_id = i.house_id
          and viewer.user_id = $2
          and viewer.status = 'active'
          and viewer.role in ('owner', 'steward')
         join memberships creator
           on creator.id = i.creator_membership_id and creator.house_id = i.house_id
         join users creator_user on creator_user.id = creator.user_id
        where i.house_id = $1
          and i.revoked_at is null
          and i.expires_at > $3
          and i.use_count < i.use_limit
        order by i.created_at desc, i.id desc
        limit ${PENDING_INVITATION_LIMIT}`,
      [context.houseId, context.viewerId, now],
    );
    return result.rows.map(pendingInvitation);
  }
}
