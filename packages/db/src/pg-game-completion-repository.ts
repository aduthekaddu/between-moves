import {
  AuthorizationDeniedError,
  DomainError,
  GAME_DRAW_OFFER_CHANGED_TOPIC,
  MoveConflictError,
  RetryableTransactionError,
  type AuthorizationContext,
  type CompletedGameResult,
  type DrawGameInput,
  type GameCompletionInput,
  type GameCompletionRepository,
  type GameLifecycleResult,
} from '@between-moves/domain';
import type { Pool, PoolClient } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';
import { enqueueGameCompletionEvents } from './game-completion-events';
import { allocateGameCompletionSequence } from './game-completion-sequence';
import {
  bigInteger,
  integer,
  loadGame,
  nullableText,
  recordCommand,
  replayCommand,
  seated,
  side,
  snapshot,
  text,
  type LifecycleAction,
  type LockedGameRow,
} from './pg-game-completion-state';

async function finish(
  client: PoolClient,
  context: AuthorizationContext,
  input: GameCompletionInput,
  game: LockedGameRow,
  result: CompletedGameResult,
  reason: 'resign' | 'agreement',
): Promise<GameLifecycleResult> {
  const nextVersion = integer(game.version, 'version') + 1;
  const firstEventSequence = bigInteger(game.outbox_sequence, 'outbox sequence') + 1n;
  const completionSequence = await allocateGameCompletionSequence(
    client,
    context.houseId,
    text(game.season_id, 'Season id'),
  );
  await client.query(
    `update games set state='completed', result=$3, result_reason=$4, completed_at=$5,
                      version=$6, move_due_at=null, turn_started_at=null,
                      draw_offer_membership_id=null, draw_offer_ply=null,
                      outbox_sequence=$7, season_completion_sequence=$8
      where id=$1 and house_id=$2`,
    [
      input.gameId,
      context.houseId,
      result,
      reason,
      input.completedAt,
      nextVersion,
      (firstEventSequence + 1n).toString(),
      completionSequence.toString(),
    ],
  );
  await enqueueGameCompletionEvents(
    context,
    {
      gameId: input.gameId,
      completedEventId: input.completedEventId,
      analysisEventId: input.analysisEventId,
      result,
      resultReason: reason,
      completedAt: input.completedAt,
      firstSequence: firstEventSequence,
    },
    client,
  );
  return {
    gameId: input.gameId,
    houseId: context.houseId,
    state: 'completed',
    result,
    resultReason: reason,
    completedAt: input.completedAt,
    pendingDrawOffer: null,
    completedNow: true,
    replayed: false,
  };
}

async function resignInTransaction(
  client: PoolClient,
  context: AuthorizationContext,
  input: GameCompletionInput,
): Promise<GameLifecycleResult> {
  const game = await loadGame(client, context, input.gameId);
  const seats = seated(game);
  const repeated = await replayCommand(client, context, input, 'resign', game);
  if (repeated !== null) return repeated;
  if (game.state !== 'active') throw new DomainError('conflict', 'Game is not active');
  const ply = integer(game.current_ply, 'current ply');
  const outcome = await finish(
    client,
    context,
    input,
    game,
    seats.actor === seats.white ? 'black_win' : 'white_win',
    'resign',
  );
  await recordCommand(client, context, input, seats.actor, 'resign', ply, outcome);
  return outcome;
}

/**
 * [BM-028] [DR-DRAW-02] Tell both players' boards an offer was made or declined. The notice
 * takes the Game's next aggregate sequence, like a Move, so realtime readers stay in order.
 */
async function announceDrawOfferChange(
  client: PoolClient,
  context: AuthorizationContext,
  input: DrawGameInput,
  game: LockedGameRow,
  change: { readonly kind: 'offered' | 'declined'; readonly offeringMembershipId: string },
  ply: number,
): Promise<void> {
  const sequence = bigInteger(game.outbox_sequence, 'outbox sequence') + 1n;
  await client.query(`update games set outbox_sequence=$3 where id=$1 and house_id=$2`, [
    input.gameId,
    context.houseId,
    sequence.toString(),
  ]);
  await enqueueOutboxEvent(
    {
      id: input.offerEventId,
      topic: GAME_DRAW_OFFER_CHANGED_TOPIC,
      aggregateId: input.gameId,
      sequence,
      houseId: context.houseId,
      payload: { change: change.kind, offeringMembershipId: change.offeringMembershipId, ply },
      availableAt: input.completedAt,
      occurredAt: input.completedAt,
    },
    client,
  );
}

async function offerDraw(
  client: PoolClient,
  context: AuthorizationContext,
  input: DrawGameInput,
  game: LockedGameRow,
  actor: string,
  currentActor: string,
  ply: number,
): Promise<GameLifecycleResult> {
  if (actor === currentActor) {
    throw new AuthorizationDeniedError("A draw may be offered only on the opponent's turn");
  }
  const offerer = nullableText(game.draw_offer_membership_id, 'draw offer membership id');
  const offerPly = game.draw_offer_ply === null ? null : integer(game.draw_offer_ply, 'offer ply');
  if (offerer !== null && (offerer !== actor || offerPly !== ply)) {
    throw new DomainError('conflict', 'A draw offer is already pending');
  }
  if (offerer === null) {
    // one offer per Move: a declined offer can be renewed only after the offerer moves again
    const declined = await client.query(
      `select 1 from game_lifecycle_commands
        where game_id=$1 and house_id=$2 and action='draw_decline' and command_ply=$3
        limit 1`,
      [input.gameId, context.houseId, ply],
    );
    if (declined.rows.length > 0) {
      throw new DomainError(
        'conflict',
        'Your draw offer was declined. You can offer again after your next Move.',
      );
    }
    await client.query(
      `update games set draw_offer_membership_id=$3, draw_offer_ply=$4
        where id=$1 and house_id=$2`,
      [input.gameId, context.houseId, actor, ply],
    );
    await announceDrawOfferChange(
      client,
      context,
      input,
      game,
      { kind: 'offered', offeringMembershipId: actor },
      ply,
    );
  }
  const outcome = snapshot(
    { ...game, draw_offer_membership_id: actor, draw_offer_ply: ply },
    context,
    input.gameId,
    false,
  );
  await recordCommand(client, context, input, actor, 'draw_offer', ply, outcome);
  return outcome;
}

function withdrawnOffer(game: LockedGameRow, ply: number): MoveConflictError {
  return new MoveConflictError({
    version: integer(game.version, 'version'),
    currentPly: ply,
    fen: text(game.current_fen, 'current FEN'),
  });
}

/** [BM-028] [DR-DRAW-02] The opponent turns an offer down; play continues on their turn. */
async function declineDraw(
  client: PoolClient,
  context: AuthorizationContext,
  input: DrawGameInput,
  game: LockedGameRow,
  actor: string,
  currentActor: string,
  ply: number,
): Promise<GameLifecycleResult> {
  const offerer = nullableText(game.draw_offer_membership_id, 'draw offer membership id');
  if (offerer === null || game.draw_offer_ply === null) throw withdrawnOffer(game, ply);
  if (offerer === actor || actor !== currentActor) {
    throw new AuthorizationDeniedError('Only the opponent may decline a draw offer');
  }
  await client.query(
    `update games set draw_offer_membership_id=null, draw_offer_ply=null
      where id=$1 and house_id=$2`,
    [input.gameId, context.houseId],
  );
  await announceDrawOfferChange(
    client,
    context,
    input,
    game,
    { kind: 'declined', offeringMembershipId: offerer },
    ply,
  );
  const outcome = snapshot(
    { ...game, draw_offer_membership_id: null, draw_offer_ply: null },
    context,
    input.gameId,
    false,
  );
  await recordCommand(client, context, input, actor, 'draw_decline', ply, outcome);
  return outcome;
}

async function acceptDraw(
  client: PoolClient,
  context: AuthorizationContext,
  input: DrawGameInput,
  game: LockedGameRow,
  actor: string,
  currentActor: string,
  ply: number,
): Promise<GameLifecycleResult> {
  const offerer = nullableText(game.draw_offer_membership_id, 'draw offer membership id');
  if (offerer === null || game.draw_offer_ply === null) throw withdrawnOffer(game, ply);
  if (offerer === actor || actor !== currentActor) {
    throw new AuthorizationDeniedError('Only the opponent may accept a draw offer');
  }
  const outcome = await finish(client, context, input, game, 'draw', 'agreement');
  await recordCommand(client, context, input, actor, 'draw_accept', ply, outcome);
  return outcome;
}

const DRAW_ACTIONS = {
  offer: 'draw_offer',
  accept: 'draw_accept',
  decline: 'draw_decline',
} as const satisfies Record<DrawGameInput['action'], LifecycleAction>;

async function drawInTransaction(
  client: PoolClient,
  context: AuthorizationContext,
  input: DrawGameInput,
): Promise<GameLifecycleResult> {
  const action = DRAW_ACTIONS[input.action];
  const game = await loadGame(client, context, input.gameId);
  const seats = seated(game);
  const repeated = await replayCommand(client, context, input, action, game);
  if (repeated !== null) return repeated;
  if (game.state !== 'active') {
    // an offer ends with its Game, so there is nothing left to accept or decline
    if (input.action !== 'offer') {
      throw withdrawnOffer(game, integer(game.current_ply, 'current ply'));
    }
    throw new DomainError('conflict', 'Game is not active');
  }
  const ply = integer(game.current_ply, 'current ply');
  const currentActor = side(game.side_to_move) === 'white' ? seats.white : seats.black;
  if (input.action === 'offer') {
    return offerDraw(client, context, input, game, seats.actor, currentActor, ply);
  }
  return input.action === 'accept'
    ? acceptDraw(client, context, input, game, seats.actor, currentActor, ply)
    : declineDraw(client, context, input, game, seats.actor, currentActor, ply);
}

function transactionError(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === '40001' || error.code === '40P01')
  ) {
    return new RetryableTransactionError('Game completion transaction must be retried', {
      cause: error,
    });
  }
  return error;
}

/** [BM-028] Atomic resignation/draw persistence with completion outbox events. */
export class PgGameCompletionRepository implements GameCompletionRepository {
  constructor(private readonly database: Pool) {}

  resign(context: AuthorizationContext, input: GameCompletionInput): Promise<GameLifecycleResult> {
    return this.transaction((client) => resignInTransaction(client, context, input));
  }

  draw(context: AuthorizationContext, input: DrawGameInput): Promise<GameLifecycleResult> {
    return this.transaction((client) => drawInTransaction(client, context, input));
  }

  private async transaction(
    operation: (client: PoolClient) => Promise<GameLifecycleResult>,
  ): Promise<GameLifecycleResult> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw transactionError(error);
    } finally {
      client.release();
    }
  }
}
