import type {
  AuthorizationContext,
  GamePosition,
  GamePositionMember,
  GamePositionMove,
  GamePositionReadRepository,
  GamePositionResult,
  GamePositionState,
  PendingDrawOffer,
  SideToMove,
} from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface GamePositionRow extends QueryResultRow {
  readonly game_id: unknown;
  readonly mode: unknown;
  readonly state: unknown;
  readonly current_fen: unknown;
  readonly current_ply: unknown;
  readonly side_to_move: unknown;
  readonly version: unknown;
  readonly white_membership_id: unknown;
  readonly white_name: unknown;
  readonly black_membership_id: unknown;
  readonly black_name: unknown;
  readonly viewer_membership_id: unknown;
  readonly move_due_at: unknown;
  readonly white_clock_ms: unknown;
  readonly black_clock_ms: unknown;
  readonly turn_started_at: unknown;
  readonly result: unknown;
  readonly moves: unknown;
  readonly draw_offer_membership_id: unknown;
  readonly draw_offer_ply: unknown;
  readonly draw_offer_declined: unknown;
}

interface GameMoveRow {
  readonly ply: unknown;
  readonly uci: unknown;
  readonly san: unknown;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Game position ${field}`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid Game position ${field}`);
  }
  return value;
}

function side(value: unknown): SideToMove {
  if (value !== 'white' && value !== 'black') throw new Error('Invalid Game position turn');
  return value;
}

function state(value: unknown): GamePositionState {
  if (value === 'active' || value === 'completed') return value;
  throw new Error('Invalid Game position state');
}

function result(value: unknown): GamePositionResult | null {
  if (value === null) return null;
  if (value === 'white_win' || value === 'black_win' || value === 'draw' || value === 'aborted') {
    return value;
  }
  throw new Error('Invalid Game position result');
}

function date(value: unknown): Date | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(text(value, 'deadline'));
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid Game position deadline');
  return parsed;
}

function member(row: GamePositionRow, color: 'white' | 'black'): GamePositionMember {
  return {
    membershipId: text(row[`${color}_membership_id`], `${color} membership id`),
    name: text(row[`${color}_name`], `${color} name`),
  };
}

function move(row: GameMoveRow): GamePositionMove {
  const ply = integer(row.ply, 'Move ply');
  if (ply < 1) throw new Error('Invalid Game position Move ply');
  return { ply, uci: text(row.uci, 'Move UCI'), san: text(row.san, 'Move SAN') };
}

function drawOffer(row: GamePositionRow): PendingDrawOffer | null {
  if (row.draw_offer_membership_id === null && row.draw_offer_ply === null) return null;
  return {
    offeringMembershipId: text(row.draw_offer_membership_id, 'draw offer membership id'),
    ply: integer(row.draw_offer_ply, 'draw offer ply'),
  };
}

function moveHistory(value: unknown): readonly GamePositionMove[] {
  if (!Array.isArray(value)) throw new Error('Invalid Game position Move history');
  return value.map((candidate) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Invalid Game position Move');
    }
    return move(candidate as unknown as GameMoveRow);
  });
}

/** [BM-027] [DR-SEC-01] Read canonical Game state behind House and membership predicates. */
export class PgGamePositionRepository implements GamePositionReadRepository {
  constructor(private readonly database: Pool) {}

  async readGamePosition(
    context: AuthorizationContext,
    gameId: string,
  ): Promise<GamePosition | null> {
    const gameResult = await this.database.query<GamePositionRow>(
      `select g.id::text as game_id, g.mode, g.state, g.current_fen, g.current_ply,
              g.side_to_move, g.version, g.move_due_at, g.result,
              g.white_clock_ms, g.black_clock_ms, g.turn_started_at,
              g.draw_offer_membership_id::text as draw_offer_membership_id, g.draw_offer_ply,
              exists(
                select 1 from game_lifecycle_commands c
                 where c.game_id = g.id and c.house_id = g.house_id
                   and c.action = 'draw_decline' and c.command_ply = g.current_ply
              ) as draw_offer_declined,
              white_member.id::text as white_membership_id,
              coalesce(white_member.display_name_snapshot, white_user.display_name) as white_name,
              black_member.id::text as black_membership_id,
              coalesce(black_member.display_name_snapshot, black_user.display_name) as black_name,
              viewer_member.id::text as viewer_membership_id,
              coalesce((
                select jsonb_agg(
                         jsonb_build_object('ply', m.ply, 'uci', m.uci, 'san', m.san)
                         order by m.ply
                       )
                  from moves m
                 where m.house_id = g.house_id and m.game_id = g.id
              ), '[]'::jsonb) as moves
         from games g
         join houses h on h.id = g.house_id and h.status = 'active'
         join memberships viewer_member
           on viewer_member.house_id = g.house_id
          and viewer_member.user_id = $3
          and viewer_member.status = 'active'
         join memberships white_member
           on white_member.house_id = g.house_id and white_member.id = g.white_membership_id
         join users white_user on white_user.id = white_member.user_id
         join memberships black_member
           on black_member.house_id = g.house_id and black_member.id = g.black_membership_id
         join users black_user on black_user.id = black_member.user_id
        where g.house_id = $1 and g.id = $2 and g.state in ('active', 'completed')`,
      [context.houseId, gameId, context.viewerId],
    );
    const row = gameResult.rows[0];
    if (row === undefined) return null;

    const white = member(row, 'white');
    const black = member(row, 'black');
    const viewerMembershipId = text(row.viewer_membership_id, 'viewer membership id');
    const viewerColor =
      viewerMembershipId === white.membershipId
        ? 'white'
        : viewerMembershipId === black.membershipId
          ? 'black'
          : null;
    const gameState = state(row.state);
    const sideToMove = side(row.side_to_move);
    const moves = moveHistory(row.moves);
    const lastSan = moves.at(-1)?.san;
    return {
      gameId: text(row.game_id, 'Game id'),
      mode:
        row.mode === 'correspondence' || row.mode === 'live'
          ? row.mode
          : (() => {
              throw new Error('Invalid Game position mode');
            })(),
      state: gameState,
      currentFen: text(row.current_fen, 'FEN'),
      currentPly: integer(row.current_ply, 'ply'),
      sideToMove,
      version: integer(row.version, 'version'),
      white,
      black,
      viewerColor,
      canMove: gameState === 'active' && viewerColor === sideToMove,
      moveDueAt: date(row.move_due_at),
      ...(row.mode === 'live'
        ? {
            liveClock: {
              whiteMs: integer(row.white_clock_ms, 'white clock'),
              blackMs: integer(row.black_clock_ms, 'black clock'),
              turnStartedAt: date(row.turn_started_at),
            },
          }
        : {}),
      result: result(row.result),
      inCheck: lastSan?.endsWith('+') === true || lastSan?.endsWith('#') === true,
      moves,
      pendingDrawOffer: drawOffer(row),
      drawOfferDeclined: gameState === 'active' && row.draw_offer_declined === true,
    };
  }
}
