import {
  AuthorizationDeniedError,
  DomainError,
  type AuthorizationContext,
  type CompletedGameResult,
  type GameCompletionInput,
  type GameCompletionReason,
  type GameLifecycleResult,
  type SideToMove,
} from '@between-moves/domain';
import type { PoolClient, QueryResultRow } from 'pg';

export type LifecycleAction = 'resign' | 'draw_offer' | 'draw_accept';

export interface LockedGameRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly state: unknown;
  readonly white_membership_id: unknown;
  readonly black_membership_id: unknown;
  readonly current_fen: unknown;
  readonly current_ply: unknown;
  readonly side_to_move: unknown;
  readonly version: unknown;
  readonly result: unknown;
  readonly result_reason: unknown;
  readonly completed_at: unknown;
  readonly draw_offer_membership_id: unknown;
  readonly draw_offer_ply: unknown;
}

interface StoredCommandRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly action: unknown;
  readonly outcome: unknown;
}

export function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Game ${field}`);
  return value;
}

export function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

export function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid Game ${field}`);
  }
  return value;
}

export function side(value: unknown): SideToMove {
  if (value !== 'white' && value !== 'black') throw new Error('Invalid Game side to move');
  return value;
}

function gameResult(value: unknown): CompletedGameResult | null {
  if (value === null) return null;
  if (value === 'white_win' || value === 'black_win' || value === 'draw') return value;
  throw new Error('Invalid completed Game result');
}

function completionReason(value: unknown): GameCompletionReason | null {
  if (value === null) return null;
  if (
    value === 'checkmate' ||
    value === 'stalemate' ||
    value === 'insufficient_material' ||
    value === 'repetition' ||
    value === 'fifty_move' ||
    value === 'flag' ||
    value === 'resign' ||
    value === 'agreement' ||
    value === 'timeout'
  ) {
    return value;
  }
  throw new Error('Invalid completed Game reason');
}

function storedOutcome(
  value: unknown,
  context: AuthorizationContext,
  gameId: string,
): GameLifecycleResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Game command outcome');
  }
  const outcome = value as Record<string, unknown>;
  if (outcome.state !== 'active' && outcome.state !== 'completed') {
    throw new Error('Invalid Game command outcome state');
  }
  const result = gameResult(outcome.result);
  const resultReason = completionReason(outcome.resultReason);
  const completedAt = outcome.completedAt;
  const offer = outcome.pendingDrawOffer;
  let pendingDrawOffer = null;
  if (offer !== null) {
    if (typeof offer !== 'object' || Array.isArray(offer)) {
      throw new Error('Invalid stored draw offer');
    }
    const fields = offer as Record<string, unknown>;
    pendingDrawOffer = {
      offeringMembershipId: text(fields.offeringMembershipId, 'stored draw offer membership'),
      ply: integer(fields.ply, 'stored draw offer ply'),
    };
  }
  const parsedCompletedAt =
    completedAt === null ? null : new Date(text(completedAt, 'stored completion timestamp'));
  if (parsedCompletedAt !== null && Number.isNaN(parsedCompletedAt.getTime())) {
    throw new Error('Invalid stored completion timestamp');
  }
  if (
    (outcome.state === 'active' &&
      (result !== null || resultReason !== null || parsedCompletedAt !== null)) ||
    (outcome.state === 'completed' &&
      (result === null || resultReason === null || parsedCompletedAt === null))
  ) {
    throw new Error('Invalid Game command outcome completion');
  }
  return {
    gameId,
    houseId: context.houseId,
    state: outcome.state,
    result,
    resultReason,
    completedAt: parsedCompletedAt,
    pendingDrawOffer,
    completedNow: false,
    replayed: true,
  };
}

export function snapshot(
  row: LockedGameRow,
  context: AuthorizationContext,
  gameId: string,
  replayed: boolean,
): GameLifecycleResult {
  const state = row.state;
  if (state !== 'active' && state !== 'completed') throw new Error('Invalid lifecycle state');
  const result = gameResult(row.result);
  const resultReason = nullableText(row.result_reason, 'result reason');
  const completedAt = row.completed_at;
  const offerer = nullableText(row.draw_offer_membership_id, 'draw offer membership id');
  const offerPly =
    row.draw_offer_ply === null ? null : integer(row.draw_offer_ply, 'draw offer ply');
  if ((offerer === null) !== (offerPly === null)) throw new Error('Invalid pending draw offer');
  if (
    state === 'completed' &&
    (result === null || resultReason === null || !(completedAt instanceof Date))
  ) {
    throw new Error('Invalid completed Game snapshot');
  }
  return {
    gameId,
    houseId: context.houseId,
    state,
    result,
    resultReason: resultReason as GameLifecycleResult['resultReason'],
    completedAt: completedAt instanceof Date ? completedAt : null,
    pendingDrawOffer:
      offerer === null || offerPly === null
        ? null
        : { offeringMembershipId: offerer, ply: offerPly },
    completedNow: false,
    replayed,
  };
}

export async function loadGame(
  client: PoolClient,
  context: AuthorizationContext,
  gameId: string,
): Promise<LockedGameRow> {
  const result = await client.query<LockedGameRow>(
    `select actor.id::text as actor_membership_id, g.state,
            g.white_membership_id::text, g.black_membership_id::text,
            g.current_fen, g.current_ply, g.side_to_move, g.version,
            g.result, g.result_reason, g.completed_at,
            g.draw_offer_membership_id::text, g.draw_offer_ply
       from games g
       join memberships actor
         on actor.house_id=g.house_id and actor.user_id=$3 and actor.status='active'
      where g.house_id=$1 and g.id=$2
      for update of g, actor`,
    [context.houseId, gameId, context.viewerId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new DomainError('not_found', 'Game is unavailable');
  return row;
}

export function seated(row: LockedGameRow) {
  const actor = text(row.actor_membership_id, 'actor membership id');
  const white = nullableText(row.white_membership_id, 'white membership id');
  const black = nullableText(row.black_membership_id, 'black membership id');
  if (actor !== white && actor !== black) {
    throw new AuthorizationDeniedError('Only a seated Member can change a Game result');
  }
  if (white === null || black === null) throw new Error('Active Game must have two seats');
  return { actor, white, black };
}

export async function replayCommand(
  client: PoolClient,
  context: AuthorizationContext,
  input: GameCompletionInput,
  action: LifecycleAction,
  game: LockedGameRow,
): Promise<GameLifecycleResult | null> {
  const result = await client.query<StoredCommandRow>(
    `select actor_membership_id::text, action, outcome from game_lifecycle_commands
      where game_id=$1 and house_id=$2 and client_command_id=$3`,
    [input.gameId, context.houseId, input.clientCommandId],
  );
  const stored = result.rows[0];
  if (stored === undefined) return null;
  if (
    text(stored.actor_membership_id, 'command actor') !== text(game.actor_membership_id, 'actor')
  ) {
    throw new AuthorizationDeniedError('A Game command can only be replayed by its actor');
  }
  if (stored.action !== action) throw new DomainError('conflict', 'Command ID was already used');
  return storedOutcome(stored.outcome, context, input.gameId);
}

export async function recordCommand(
  client: PoolClient,
  context: AuthorizationContext,
  input: GameCompletionInput,
  actor: string,
  action: LifecycleAction,
  ply: number,
  outcome: GameLifecycleResult,
): Promise<void> {
  await client.query(
    `insert into game_lifecycle_commands
      (game_id, house_id, actor_membership_id, client_command_id, action, command_ply,
       outcome, created_at)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      input.gameId,
      context.houseId,
      actor,
      input.clientCommandId,
      action,
      ply,
      JSON.stringify({
        state: outcome.state,
        result: outcome.result,
        resultReason: outcome.resultReason,
        completedAt: outcome.completedAt?.toISOString() ?? null,
        pendingDrawOffer: outcome.pendingDrawOffer,
      }),
      input.completedAt,
    ],
  );
}
