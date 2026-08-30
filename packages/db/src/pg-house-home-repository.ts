import type {
  AuthorizationContext,
  HouseHome,
  HouseHomeReadRepository,
  MembershipRole,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface HouseHomeRow extends QueryResultRow {
  readonly house_id: unknown;
  readonly name: unknown;
  readonly description: unknown;
  readonly emblem_seed: unknown;
  readonly time_zone: unknown;
  readonly membership_role: unknown;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid House home ${field}`);
  return value;
}

function parseNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return parseString(value, field);
}

function parseRole(value: unknown): MembershipRole {
  switch (value) {
    case 'owner':
    case 'steward':
    case 'member':
      return value;
    default:
      throw new Error('Invalid House home membership role');
  }
}

function parseHouseHome(row: HouseHomeRow): HouseHome {
  return {
    houseId: parseString(row.house_id, 'id'),
    name: parseString(row.name, 'name'),
    description: parseNullableString(row.description, 'description'),
    emblemSeed: parseString(row.emblem_seed, 'emblem seed'),
    timeZone: parseString(row.time_zone, 'time zone'),
    membershipRole: parseRole(row.membership_role),
  };
}

/** [BM-013] [DR-MEM-04] Read through House, viewer, and active-membership predicates. */
export class PgHouseHomeRepository implements HouseHomeReadRepository {
  constructor(private readonly database: Pool) {}

  async read(context: AuthorizationContext): Promise<HouseHome | null> {
    const result = await this.database.query<HouseHomeRow>(
      `select h.id::text as house_id,
              h.name,
              h.description,
              h.emblem_seed,
              h.time_zone,
              m.role as membership_role
         from houses h
         join memberships m
           on m.house_id = h.id
          and m.user_id = $2
          and m.status = 'active'
        where h.id = $1
          and h.status = 'active'
        limit 1`,
      [context.houseId, context.viewerId],
    );
    const row = result.rows[0];
    return row === undefined ? null : parseHouseHome(row);
  }
}
