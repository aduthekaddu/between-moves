import {
  nightSequenceForState,
  RAIL_RECENT_RESULT_LIMIT,
  type AuthorizationContext,
  type NightRailBoard,
  type NightRailPlayer,
  type NightRailRepository,
  type NightRailResult,
  type NightRailResultValue,
  type NightRailSnapshot,
  type NightState,
  type SideToMove,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface NightRailRow extends QueryResultRow {
  readonly house_id: unknown;
  readonly night_id: unknown;
  readonly season_id: unknown;
  readonly scheduled_start: unknown;
  readonly scheduled_end: unknown;
  readonly state: unknown;
  readonly started_at: unknown;
  readonly ended_at: unknown;
}

interface RailGameRow extends QueryResultRow {
  readonly game_id: unknown;
  readonly sequence: unknown;
  readonly current_fen: unknown;
  readonly current_ply: unknown;
  readonly side_to_move: unknown;
  readonly last_san: unknown;
  readonly result: unknown;
  readonly result_reason: unknown;
  readonly completed_at: unknown;
  readonly white_membership_id: unknown;
  readonly white_name: unknown;
  readonly black_membership_id: unknown;
  readonly black_name: unknown;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Night rail ${field}`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid Night rail ${field}`);
  }
  return value;
}

function bigInteger(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`Invalid Night rail ${field}`);
  }
  return BigInt(value);
}

function date(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid Night rail ${field}`);
  }
  return value;
}

function nullableDate(value: unknown, field: string): Date | null {
  return value === null ? null : date(value, field);
}

function nightState(value: unknown): NightState {
  if (value === 'scheduled' || value === 'live' || value === 'ended' || value === 'cancelled') {
    return value;
  }
  throw new Error('Invalid Night rail state');
}

function side(value: unknown): SideToMove {
  if (value !== 'white' && value !== 'black') throw new Error('Invalid Night rail side to move');
  return value;
}

function resultValue(value: unknown): NightRailResultValue {
  if (value === 'white_win' || value === 'black_win' || value === 'draw' || value === 'aborted') {
    return value;
  }
  throw new Error('Invalid Night rail result');
}

function player(row: RailGameRow, color: 'white' | 'black'): NightRailPlayer {
  return {
    membershipId: text(row[`${color}_membership_id`], `${color} membership id`),
    name: text(row[`${color}_name`], `${color} name`),
  };
}

function board(row: RailGameRow): NightRailBoard {
  return {
    gameId: text(row.game_id, 'Game id'),
    sequence: bigInteger(row.sequence, 'sequence'),
    currentFen: text(row.current_fen, 'FEN'),
    currentPly: integer(row.current_ply, 'ply'),
    sideToMove: side(row.side_to_move),
    lastSan: row.last_san === null ? null : text(row.last_san, 'last SAN'),
    white: player(row, 'white'),
    black: player(row, 'black'),
  };
}

function completed(row: RailGameRow): NightRailResult {
  return {
    gameId: text(row.game_id, 'Game id'),
    sequence: bigInteger(row.sequence, 'sequence'),
    result: resultValue(row.result),
    resultReason: row.result_reason === null ? null : text(row.result_reason, 'result reason'),
    completedAt: date(row.completed_at, 'completed at'),
    white: player(row, 'white'),
    black: player(row, 'black'),
  };
}

const gamePlayerJoins = `
  join memberships white_member
    on white_member.house_id = g.house_id and white_member.id = g.white_membership_id
  join users white_user on white_user.id = white_member.user_id
  join memberships black_member
    on black_member.house_id = g.house_id and black_member.id = g.black_membership_id
  join users black_user on black_user.id = black_member.user_id`;

const gamePlayerColumns = `
  white_member.id::text as white_membership_id,
  coalesce(white_member.display_name_snapshot, white_user.display_name) as white_name,
  black_member.id::text as black_membership_id,
  coalesce(black_member.display_name_snapshot, black_user.display_name) as black_name`;

/** [BM-038] [DR-SEC-01] House-scoped durable Night rail: boards, results, presence. */
export class PgNightRailRepository implements NightRailRepository {
  constructor(private readonly database: Pool) {}

  async read(context: AuthorizationContext, nightId: string): Promise<NightRailSnapshot | null> {
    const night = await this.database.query<NightRailRow>(
      `select n.house_id::text as house_id, n.id::text as night_id, n.season_id::text as season_id,
              n.scheduled_start, n.scheduled_end, n.state, n.started_at, n.ended_at
         from house_nights n
         join seasons s
           on s.id = n.season_id and s.house_id = n.house_id
          and s.state in ('active', 'closing')
         join houses h on h.id = n.house_id and h.status = 'active'
         join memberships m
           on m.house_id = n.house_id
          and m.user_id = $3
          and m.status = 'active'
        where n.id = $1 and n.house_id = $2 and n.state <> 'cancelled'`,
      [nightId, context.houseId, context.viewerId],
    );
    const row = night.rows[0];
    if (row === undefined) return null;

    const [boards, results, presence] = await Promise.all([
      this.database.query<RailGameRow>(
        `select g.id::text as game_id, g.outbox_sequence::text as sequence, g.current_fen,
                g.current_ply, g.side_to_move, last_move.san as last_san,
                ${gamePlayerColumns}
           from games g
           ${gamePlayerJoins}
           left join lateral (
             select m.san
               from moves m
              where m.house_id = g.house_id and m.game_id = g.id
              order by m.ply desc
              limit 1
           ) last_move on true
          where g.house_id = $1 and g.night_id = $2 and g.state = 'active'
          order by g.created_at, g.id`,
        [context.houseId, nightId],
      ),
      this.database.query<RailGameRow>(
        `select g.id::text as game_id, g.outbox_sequence::text as sequence, g.current_fen,
                g.current_ply, g.side_to_move, g.result, g.result_reason, g.completed_at,
                ${gamePlayerColumns}
           from games g
           ${gamePlayerJoins}
          where g.house_id = $1 and g.night_id = $2 and g.state = 'completed'
          order by g.completed_at desc, g.id desc
          limit $3`,
        [context.houseId, nightId, RAIL_RECENT_RESULT_LIMIT],
      ),
      this.database.query<{ presence_count: unknown }>(
        `select count(*)::int as presence_count
           from night_attendance a
          where a.house_id = $1 and a.night_id = $2 and a.current_joined_at is not null`,
        [context.houseId, nightId],
      ),
    ]);

    const state = nightState(row.state);
    return {
      houseId: text(row.house_id, 'House id'),
      nightId: text(row.night_id, 'Night id'),
      seasonId: text(row.season_id, 'Season id'),
      state,
      scheduledStart: date(row.scheduled_start, 'scheduled start'),
      scheduledEnd: date(row.scheduled_end, 'scheduled end'),
      startedAt: nullableDate(row.started_at, 'started at'),
      endedAt: nullableDate(row.ended_at, 'ended at'),
      nightSequence: nightSequenceForState(state),
      presenceCount: integer(presence.rows[0]?.presence_count, 'presence count'),
      activeBoards: boards.rows.map(board),
      recentResults: results.rows.map(completed),
    };
  }
}
