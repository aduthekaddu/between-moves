import {
  AuthorizationDeniedError,
  DomainError,
  type AuthorizationContext,
  type GameSeatAcceptanceInput,
  type GameSeatAcceptanceRepository,
  type GameSeatAcceptanceResult,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface AcceptanceRow extends QueryResultRow {
  readonly actor_membership_id: unknown;
  readonly game_state: unknown;
  readonly white_membership_id: unknown;
  readonly black_membership_id: unknown;
  readonly clock_policy: unknown;
  readonly mode: unknown;
  readonly night_id: unknown;
  readonly seat_state: unknown;
  readonly creator_membership_id: unknown;
  readonly intended_membership_id: unknown;
  readonly expires_at: unknown;
}

type TransactionResult = GameSeatAcceptanceResult | { readonly expired: true };

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Game acceptance ${field}`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : stringValue(value, field);
}

function perMoveHours(value: unknown): number {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid correspondence clock policy');
  }
  const policy = value as Record<string, unknown>;
  if (
    policy.kind !== 'correspondence' ||
    !Number.isInteger(policy.perMoveHours) ||
    typeof policy.perMoveHours !== 'number' ||
    policy.perMoveHours <= 0
  ) {
    throw new Error('Invalid correspondence clock policy');
  }
  return policy.perMoveHours;
}

async function lockedAcceptanceRow(
  client: PoolClient,
  context: AuthorizationContext,
  gameId: string,
): Promise<AcceptanceRow> {
  const result = await client.query<AcceptanceRow>(
    `select actor.id::text as actor_membership_id, g.state as game_state,
            g.white_membership_id::text, g.black_membership_id::text, g.clock_policy,
            g.mode, g.night_id::text,
            s.state as seat_state, s.creator_membership_id::text,
            s.intended_membership_id::text, s.expires_at
       from games g
       join open_seats s on s.game_id = g.id and s.house_id = g.house_id
       join memberships actor
         on actor.house_id = g.house_id and actor.user_id = $3 and actor.status = 'active'
      where g.house_id = $1 and g.id = $2
      order by s.created_at desc
      limit 1
      for update of g, s, actor`,
    [context.houseId, gameId, context.viewerId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new DomainError('not_found', 'Open seat is unavailable');
  return row;
}

async function acceptInTransaction(
  client: PoolClient,
  context: AuthorizationContext,
  input: GameSeatAcceptanceInput,
): Promise<TransactionResult> {
  const row = await lockedAcceptanceRow(client, context, input.gameId);
  if (row.game_state !== 'waiting' || row.seat_state !== 'open') {
    throw new DomainError('conflict', 'Open seat is already taken');
  }
  const actorMembershipId = stringValue(row.actor_membership_id, 'actor membership id');
  const creatorMembershipId = stringValue(row.creator_membership_id, 'creator membership id');
  const intendedMembershipId = nullableString(row.intended_membership_id, 'intended membership id');
  if (actorMembershipId === creatorMembershipId) {
    throw new AuthorizationDeniedError('A seat creator cannot accept their own Open seat');
  }
  if (intendedMembershipId !== null && intendedMembershipId !== actorMembershipId) {
    throw new AuthorizationDeniedError('Only the intended Member can accept this challenge');
  }
  if (!(row.expires_at instanceof Date) || Number.isNaN(row.expires_at.getTime())) {
    throw new Error('Invalid Game acceptance expiry');
  }
  if (input.acceptedAt.getTime() > row.expires_at.getTime()) {
    await client.query(
      `update open_seats set state = 'expired'
        where game_id = $1 and house_id = $2 and state = 'open'`,
      [input.gameId, context.houseId],
    );
    return { expired: true };
  }

  const priorWhite = nullableString(row.white_membership_id, 'white membership id');
  const priorBlack = nullableString(row.black_membership_id, 'black membership id');
  if ((priorWhite === null) === (priorBlack === null)) {
    throw new Error('Waiting Game must have exactly one occupied seat');
  }
  const whiteMembershipId = priorWhite ?? actorMembershipId;
  const blackMembershipId = priorBlack ?? actorMembershipId;
  const moveDueAt =
    row.mode === 'correspondence'
      ? new Date(input.acceptedAt.getTime() + perMoveHours(row.clock_policy) * 60 * 60 * 1_000)
      : null;
  if (moveDueAt !== null && Number.isNaN(moveDueAt.getTime()))
    throw new Error('Invalid Game move deadline');
  if (row.mode === 'live') {
    const night = await client.query(
      `select 1 from house_nights where id=$1 and house_id=$2 and state='live' for share`,
      [row.night_id, context.houseId],
    );
    if (night.rowCount !== 1) throw new DomainError('conflict', 'Night is no longer live');
  }
  const turnStartedAt =
    row.mode === 'live'
      ? new Date(
          Math.max(
            input.acceptedAt.getTime(),
            (input.startLiveClockAt?.() ?? input.acceptedAt).getTime(),
          ),
        )
      : null;
  if (turnStartedAt !== null && Number.isNaN(turnStartedAt.getTime())) {
    throw new Error('Invalid live Game start time');
  }

  await client.query(
    `update games
        set state = 'active', white_membership_id = $3, black_membership_id = $4,
            move_due_at = $5, turn_started_at = $6
      where id = $1 and house_id = $2 and state = 'waiting'`,
    [input.gameId, context.houseId, whiteMembershipId, blackMembershipId, moveDueAt, turnStartedAt],
  );
  await client.query(
    `update open_seats set state = 'accepted'
      where game_id = $1 and house_id = $2 and state = 'open'`,
    [input.gameId, context.houseId],
  );
  return {
    gameId: input.gameId,
    houseId: context.houseId,
    whiteMembershipId,
    blackMembershipId,
    moveDueAt,
    ...(turnStartedAt === null ? {} : { turnStartedAt }),
    state: 'active',
  };
}

/** [BM-023] [DR-SEAT-03] Lock and activate one Open seat in a single transaction. */
export class PgGameSeatAcceptanceRepository implements GameSeatAcceptanceRepository {
  constructor(private readonly database: Pool) {}

  async accept(
    context: AuthorizationContext,
    input: GameSeatAcceptanceInput,
  ): Promise<GameSeatAcceptanceResult> {
    const client = await this.database.connect();
    let result: TransactionResult;
    try {
      await client.query('begin');
      result = await acceptInTransaction(client, context, input);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if ('expired' in result) throw new DomainError('not_found', 'Open seat has expired');
    return result;
  }
}
