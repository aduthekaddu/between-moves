import type {
  HouseAuthorizationMembership,
  HouseAuthorizationMembershipRepository,
  MembershipRole,
  MembershipStatus,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface MembershipRow extends QueryResultRow {
  readonly membership_id: unknown;
  readonly house_id: unknown;
  readonly user_id: unknown;
  readonly role: unknown;
  readonly status: unknown;
}

function parseIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid membership ${field}`);
  return value;
}

function parseRole(value: unknown): MembershipRole {
  switch (value) {
    case 'owner':
    case 'steward':
    case 'member':
      return value;
    default:
      throw new Error('Invalid membership role');
  }
}

function parseStatus(value: unknown): MembershipStatus {
  switch (value) {
    case 'active':
    case 'left':
    case 'removed':
      return value;
    default:
      throw new Error('Invalid membership status');
  }
}

function parseMembership(row: MembershipRow): HouseAuthorizationMembership {
  return {
    membershipId: parseIdentifier(row.membership_id, 'id'),
    houseId: parseIdentifier(row.house_id, 'House id'),
    userId: parseIdentifier(row.user_id, 'user id'),
    role: parseRole(row.role),
    status: parseStatus(row.status),
  };
}

/** [BM-012] [DR-MEM-04] Resolve only the viewer's membership in the requested House. */
export class PgHouseAuthorizationMembershipRepository implements HouseAuthorizationMembershipRepository {
  constructor(private readonly database: Pool) {}

  async findMembership(input: {
    readonly houseId: string;
    readonly viewerId: string;
  }): Promise<HouseAuthorizationMembership | null> {
    const result = await this.database.query<MembershipRow>(
      `select id::text as membership_id, house_id::text, user_id::text, role, status
         from memberships
        where house_id = $1 and user_id = $2
        limit 1`,
      [input.houseId, input.viewerId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;

    return parseMembership(row);
  }

  async findMembershipById(input: {
    readonly houseId: string;
    readonly membershipId: string;
  }): Promise<HouseAuthorizationMembership | null> {
    const result = await this.database.query<MembershipRow>(
      `select id::text as membership_id, house_id::text, user_id::text, role, status
         from memberships
        where house_id = $1 and id = $2
        limit 1`,
      [input.houseId, input.membershipId],
    );
    const row = result.rows[0];
    return row === undefined ? null : parseMembership(row);
  }
}
