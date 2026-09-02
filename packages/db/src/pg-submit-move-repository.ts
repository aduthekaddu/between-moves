import {
  AuthorizationDeniedError,
  DomainError,
  MoveConflictError,
  RetryableTransactionError,
  type AcceptedMoveClock,
  type AuthorizationContext,
  type ClockPolicy,
  type MoveTerminalReason,
  type SideToMove,
  type SubmitMoveInput,
  type SubmitMoveRepository,
  type SubmitMoveResult,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';

interface LockedGameRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly state: unknown;
  readonly mode: unknown;
  readonly white_membership_id: unknown;
  readonly black_membership_id: unknown;
  readonly initial_fen: unknown;
  readonly current_fen: unknown;
  readonly current_ply: unknown;
  readonly side_to_move: unknown;
  readonly version: unknown;
  readonly clock_policy: unknown;
  readonly white_clock_ms: unknown;
  readonly black_clock_ms: unknown;
  readonly turn_started_at: unknown;
}

interface StoredMoveRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly accepted_version: unknown;
  readonly ply: unknown;
  readonly uci: unknown;
  readonly san: unknown;
  readonly fen_after: unknown;
  readonly server_received_at: unknown;
  readonly clock_snapshot: unknown;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Move ${field}`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new Error(`Invalid Move ${field}`);
  return value;
}

function side(value: unknown): SideToMove {
  if (value !== 'white' && value !== 'black') throw new Error('Invalid Game side to move');
  return value;
}

function policy(value: unknown): ClockPolicy {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Game clock policy');
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind === 'correspondence' &&
    typeof candidate.perMoveHours === 'number' &&
    Number.isInteger(candidate.perMoveHours) &&
    candidate.perMoveHours > 0
  ) {
    return { kind: 'correspondence', perMoveHours: candidate.perMoveHours };
  }
  if (
    candidate.kind === 'live' &&
    typeof candidate.initialMs === 'number' &&
    Number.isInteger(candidate.initialMs) &&
    candidate.initialMs >= 180_000 &&
    typeof candidate.incrementMs === 'number' &&
    Number.isInteger(candidate.incrementMs) &&
    candidate.incrementMs >= 0
  ) {
    return { kind: 'live', initialMs: candidate.initialMs, incrementMs: candidate.incrementMs };
  }
  throw new Error('Invalid Game clock policy');
}

async function loadGame(
  client: PoolClient,
  context: AuthorizationContext,
  gameId: string,
): Promise<LockedGameRow> {
  const result = await client.query<LockedGameRow>(
    `select actor.id::text as actor_membership_id, g.state, g.mode,
            g.white_membership_id::text, g.black_membership_id::text,
            g.initial_fen, g.current_fen, g.current_ply, g.side_to_move, g.version,
            g.clock_policy, g.white_clock_ms, g.black_clock_ms, g.turn_started_at
       from games g
       join memberships actor
         on actor.house_id = g.house_id and actor.user_id = $3 and actor.status = 'active'
      where g.house_id = $1 and g.id = $2
      for update of g, actor`,
    [context.houseId, gameId, context.viewerId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new DomainError('not_found', 'Game is unavailable');
  return row;
}

function clockAfterMove(row: LockedGameRow, clockPolicy: ClockPolicy, at: Date): AcceptedMoveClock {
  if (clockPolicy.kind === 'correspondence') {
    return {
      kind: 'correspondence',
      moveDueAt: new Date(at.getTime() + clockPolicy.perMoveHours * 60 * 60 * 1_000),
    };
  }
  if (!(row.turn_started_at instanceof Date)) {
    throw new Error('Invalid live Game turn timestamp');
  }
  return {
    kind: 'live',
    whiteMs: integer(row.white_clock_ms, 'white clock'),
    blackMs: integer(row.black_clock_ms, 'black clock'),
    turnStartedAt: at,
  };
}

function sideFromFen(fen: string): SideToMove {
  const turn = fen.split(' ')[1];
  if (turn === 'w') return 'white';
  if (turn === 'b') return 'black';
  throw new Error('Invalid stored Move FEN');
}

async function replay(
  client: PoolClient,
  context: AuthorizationContext,
  input: SubmitMoveInput,
  game: LockedGameRow,
  clockPolicy: ClockPolicy,
): Promise<SubmitMoveResult | null> {
  const result = await client.query<StoredMoveRow>(
    `select m.actor_membership_id::text, m.accepted_version, m.ply, m.uci, m.san, m.fen_after,
            m.server_received_at, m.clock_snapshot
       from moves m
      where m.game_id = $1 and m.house_id = $2 and m.client_command_id = $3`,
    [input.gameId, context.houseId, input.clientCommandId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  if (
    text(row.actor_membership_id, 'actor membership id') !==
    text(game.actor_membership_id, 'actor membership id')
  ) {
    throw new AuthorizationDeniedError('A Move command can only be replayed by its seated actor');
  }
  if (!(row.server_received_at instanceof Date)) throw new Error('Invalid Move receive time');
  const fenAfter = text(row.fen_after, 'FEN');
  const ply = integer(row.ply, 'ply');
  let clock: AcceptedMoveClock;
  if (clockPolicy.kind === 'correspondence') {
    clock =
      game.state === 'completed' && ply === integer(game.current_ply, 'current ply')
        ? { kind: 'correspondence', moveDueAt: null }
        : clockAfterMove(game, clockPolicy, row.server_received_at);
  } else {
    if (row.clock_snapshot === null || typeof row.clock_snapshot !== 'object') {
      throw new Error('Invalid live Move clock snapshot');
    }
    const snapshot = row.clock_snapshot as Record<string, unknown>;
    clock = {
      kind: 'live',
      whiteMs: integer(snapshot.whiteMs, 'white clock'),
      blackMs: integer(snapshot.blackMs, 'black clock'),
      turnStartedAt: row.server_received_at,
    };
  }
  return {
    gameId: input.gameId,
    houseId: context.houseId,
    ply,
    uci: text(row.uci, 'UCI'),
    san: text(row.san, 'SAN'),
    fenAfter,
    sideToMove: sideFromFen(fenAfter),
    version: integer(row.accepted_version, 'accepted version'),
    clock,
    replayed: true,
  };
}

function completion(reason: MoveTerminalReason | null, sideToMove: SideToMove) {
  if (reason === null) return { state: 'active', result: null, resultReason: null } as const;
  if (reason === 'checkmate') {
    return {
      state: 'completed',
      result: sideToMove === 'white' ? 'black_win' : 'white_win',
      resultReason: reason,
    } as const;
  }
  return { state: 'completed', result: 'draw', resultReason: reason } as const;
}

async function positionHistory(
  client: PoolClient,
  gameId: string,
  houseId: string,
  initialFen: string,
) {
  const result = await client.query<{ readonly fen_after: unknown }>(
    'select fen_after from moves where game_id = $1 and house_id = $2 order by ply',
    [gameId, houseId],
  );
  return [initialFen, ...result.rows.map((row) => text(row.fen_after, 'history FEN'))];
}

async function submitInTransaction(
  client: PoolClient,
  context: AuthorizationContext,
  input: SubmitMoveInput,
): Promise<SubmitMoveResult> {
  const game = await loadGame(client, context, input.gameId);
  const clockPolicy = policy(game.clock_policy);
  if (game.mode !== clockPolicy.kind) throw new Error('Game mode and clock policy do not match');
  const actorMembershipId = text(game.actor_membership_id, 'actor membership id');
  const whiteMembershipId = nullableText(game.white_membership_id, 'white membership id');
  const blackMembershipId = nullableText(game.black_membership_id, 'black membership id');
  if (actorMembershipId !== whiteMembershipId && actorMembershipId !== blackMembershipId) {
    throw new AuthorizationDeniedError('Only a seated Member can submit a Move');
  }
  const repeated = await replay(client, context, input, game, clockPolicy);
  if (repeated !== null) return repeated;

  const currentPly = integer(game.current_ply, 'current ply');
  const version = integer(game.version, 'version');
  const currentFen = text(game.current_fen, 'current FEN');
  if (input.expectedPly !== currentPly) {
    throw new MoveConflictError({ version, currentPly, fen: currentFen });
  }
  if (game.state !== 'active') throw new DomainError('conflict', 'Game is not active');
  if (whiteMembershipId === null || blackMembershipId === null) {
    throw new Error('Active Game must have two seated Members');
  }
  const expectedActor = side(game.side_to_move) === 'white' ? whiteMembershipId : blackMembershipId;
  if (actorMembershipId !== expectedActor) {
    throw new AuthorizationDeniedError('Only the seated Member on turn can submit a Move');
  }

  const applied = input.rules.applyMove(
    currentFen,
    input.move,
    await positionHistory(
      client,
      input.gameId,
      context.houseId,
      text(game.initial_fen, 'initial FEN'),
    ),
  );
  if (!applied.legal) throw new DomainError('validation_failed', 'Move is not legal');
  if (applied.ply !== currentPly + 1) throw new Error('Rules adapter returned an invalid ply');

  const acceptedClock = clockAfterMove(game, clockPolicy, input.receivedAt);
  const terminal = completion(applied.terminalReason, applied.sideToMove);
  const moveDueAt =
    acceptedClock.kind === 'correspondence' && terminal.state === 'active'
      ? acceptedClock.moveDueAt
      : null;
  const clockSnapshot =
    acceptedClock.kind === 'live'
      ? { whiteMs: acceptedClock.whiteMs, blackMs: acceptedClock.blackMs }
      : null;
  const nextVersion = version + 1;

  await client.query(
    `insert into moves
      (id, game_id, house_id, ply, actor_membership_id, uci, san, fen_after,
       client_command_id, accepted_version, server_received_at, clock_snapshot)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      input.moveId,
      input.gameId,
      context.houseId,
      applied.ply,
      actorMembershipId,
      applied.uci,
      applied.san,
      applied.fen,
      input.clientCommandId,
      nextVersion,
      input.receivedAt,
      clockSnapshot === null ? null : JSON.stringify(clockSnapshot),
    ],
  );
  await client.query(
    `update games
        set current_fen=$3, current_ply=$4, side_to_move=$5, version=$6,
            state=$7, result=$8, result_reason=$9, completed_at=$10,
            move_due_at=$11,
            turn_started_at=case when mode='live' and $7='active' then $12::timestamptz else null end
      where id=$1 and house_id=$2`,
    [
      input.gameId,
      context.houseId,
      applied.fen,
      applied.ply,
      applied.sideToMove,
      nextVersion,
      terminal.state,
      terminal.result,
      terminal.resultReason,
      terminal.state === 'completed' ? input.receivedAt : null,
      moveDueAt,
      input.receivedAt,
    ],
  );
  const payload = {
    ply: applied.ply,
    uci: applied.uci,
    san: applied.san,
    fenAfter: applied.fen,
    sideToMove: applied.sideToMove,
    ...(acceptedClock.kind === 'correspondence'
      ? moveDueAt === null
        ? {}
        : { moveDueAt: moveDueAt.toISOString() }
      : { whiteMs: acceptedClock.whiteMs, blackMs: acceptedClock.blackMs }),
  };
  await enqueueOutboxEvent(
    {
      id: input.outboxEventId,
      topic: 'game.move-accepted',
      aggregateId: input.gameId,
      sequence: BigInt(nextVersion),
      houseId: context.houseId,
      payload,
      availableAt: input.receivedAt,
      occurredAt: input.receivedAt,
    },
    client,
  );
  return {
    gameId: input.gameId,
    houseId: context.houseId,
    ply: applied.ply,
    uci: applied.uci,
    san: applied.san,
    fenAfter: applied.fen,
    sideToMove: applied.sideToMove,
    version: nextVersion,
    clock:
      acceptedClock.kind === 'correspondence'
        ? { kind: 'correspondence', moveDueAt }
        : acceptedClock,
    replayed: false,
  };
}

function transactionError(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === '40001' || error.code === '40P01')
  ) {
    return new RetryableTransactionError('Move transaction must be retried', { cause: error });
  }
  return error;
}

/** [BM-024] [DR-MOVE-02..07] Locks, validates, records, snapshots, and enqueues atomically. */
export class PgSubmitMoveRepository implements SubmitMoveRepository {
  constructor(private readonly database: Pool) {}

  async submit(context: AuthorizationContext, input: SubmitMoveInput): Promise<SubmitMoveResult> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const result = await submitInTransaction(client, context, input);
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
