import type {
  AuthorizationContext,
  ClockPolicy,
  OfferedGameColor,
  OpenSeatListing,
  OpenSeatMember,
  OpenSeatReadRepository,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface OpenSeatRow extends QueryResultRow {
  readonly open_seat_id: unknown;
  readonly game_id: unknown;
  readonly mode: unknown;
  readonly clock_policy: unknown;
  readonly night_id: unknown;
  readonly offered_color: unknown;
  readonly created_at: unknown;
  readonly expires_at: unknown;
  readonly creator_membership_id: unknown;
  readonly creator_name: unknown;
  readonly intended_membership_id: unknown;
  readonly intended_name: unknown;
  readonly viewer_membership_id: unknown;
}

const OPEN_SEAT_LIMIT = 50;

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid open seat ${field}`);
  return value;
}

function instant(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid open seat ${field}`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`Invalid open seat ${field}`);
  }
  return value;
}

function mode(value: unknown): OpenSeatListing['mode'] {
  if (value === 'correspondence' || value === 'live') return value;
  throw new Error('Invalid open seat mode');
}

function offeredColor(value: unknown): OfferedGameColor {
  if (value === 'white' || value === 'black' || value === 'any') return value;
  throw new Error('Invalid open seat colour');
}

function clockPolicy(value: unknown, gameMode: OpenSeatListing['mode']): ClockPolicy {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid open seat clock policy');
  }
  const policy = value as Record<string, unknown>;
  if (gameMode === 'correspondence' && policy.kind === 'correspondence') {
    return {
      kind: 'correspondence',
      perMoveHours: positiveInteger(policy.perMoveHours, 'pace', 1),
    };
  }
  if (gameMode === 'live' && policy.kind === 'live') {
    return {
      kind: 'live',
      initialMs: positiveInteger(policy.initialMs, 'initial time', 1),
      incrementMs: positiveInteger(policy.incrementMs, 'increment', 0),
    };
  }
  throw new Error('Invalid open seat clock policy');
}

function member(id: unknown, name: unknown, field: string): OpenSeatMember {
  return { membershipId: text(id, `${field} id`), name: text(name, `${field} name`) };
}

function listing(row: OpenSeatRow): OpenSeatListing {
  const gameMode = mode(row.mode);
  const viewerMembershipId = text(row.viewer_membership_id, 'viewer membership id');
  const creator = member(row.creator_membership_id, row.creator_name, 'creator');
  const intended =
    row.intended_membership_id === null
      ? null
      : member(row.intended_membership_id, row.intended_name, 'intended Member');
  const viewerIsCreator = creator.membershipId === viewerMembershipId;
  return {
    gameId: text(row.game_id, 'Game id'),
    openSeatId: text(row.open_seat_id, 'id'),
    mode: gameMode,
    clockPolicy: clockPolicy(row.clock_policy, gameMode),
    nightId: row.night_id === null ? null : text(row.night_id, 'Night id'),
    offeredColor: offeredColor(row.offered_color),
    creator,
    intended,
    createdAt: instant(row.created_at, 'creation time'),
    expiresAt: instant(row.expires_at, 'expiry'),
    viewerIsCreator,
    viewerMayAccept:
      !viewerIsCreator && (intended === null || intended.membershipId === viewerMembershipId),
  };
}

/**
 * [BM-022] [BM-023] [DR-SEC-01] Open seats of the House's active Season. Direct challenges are
 * visible only to the two Members they involve; live seats only while their Night is live.
 */
export class PgOpenSeatReadRepository implements OpenSeatReadRepository {
  constructor(private readonly database: Pool) {}

  async listOpenSeats(
    context: AuthorizationContext,
    now: Date,
  ): Promise<readonly OpenSeatListing[]> {
    const result = await this.database.query<OpenSeatRow>(
      `select os.id::text as open_seat_id,
              g.id::text as game_id,
              g.mode,
              g.clock_policy,
              g.night_id::text as night_id,
              os.offered_color,
              os.created_at,
              os.expires_at,
              creator.id::text as creator_membership_id,
              coalesce(creator.display_name_snapshot, creator_user.display_name) as creator_name,
              intended.id::text as intended_membership_id,
              coalesce(intended.display_name_snapshot, intended_user.display_name)
                as intended_name,
              viewer.id::text as viewer_membership_id
         from open_seats os
         join houses h on h.id = os.house_id and h.status = 'active'
         join games g on g.id = os.game_id and g.house_id = os.house_id and g.state = 'waiting'
         join seasons s on s.id = g.season_id and s.house_id = g.house_id and s.state = 'active'
         join memberships viewer
           on viewer.house_id = os.house_id and viewer.user_id = $2 and viewer.status = 'active'
         join memberships creator
           on creator.id = os.creator_membership_id
          and creator.house_id = os.house_id
          and creator.status = 'active'
         join users creator_user on creator_user.id = creator.user_id
         left join memberships intended
           on intended.id = os.intended_membership_id and intended.house_id = os.house_id
         left join users intended_user on intended_user.id = intended.user_id
         left join house_nights n on n.id = g.night_id and n.house_id = g.house_id
        where os.house_id = $1
          and os.state = 'open'
          and os.expires_at > $3
          and (os.intended_membership_id is null
               or os.intended_membership_id = viewer.id
               or os.creator_membership_id = viewer.id)
          and (os.intended_membership_id is null or intended.status = 'active')
          and (g.mode = 'correspondence' or n.state = 'live')
        order by os.created_at, os.id
        limit ${OPEN_SEAT_LIMIT}`,
      [context.houseId, context.viewerId, now],
    );
    return result.rows.map(listing);
  }
}
