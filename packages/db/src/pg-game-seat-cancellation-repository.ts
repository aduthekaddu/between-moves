import {
  AuthorizationDeniedError,
  DomainError,
  type AuthorizationContext,
  type GameSeatCancellationInput,
  type GameSeatCancellationRepository,
  type GameSeatCancellationResult,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface LockedSeatRow extends QueryResultRow {
  readonly open_seat_id: unknown;
  readonly seat_state: unknown;
  readonly game_state: unknown;
  readonly creator_membership_id: unknown;
  readonly intended_membership_id: unknown;
  readonly actor_membership_id: unknown;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Open seat ${field}`);
  return value;
}

async function cancelInTransaction(
  client: PoolClient,
  context: AuthorizationContext,
  input: GameSeatCancellationInput,
): Promise<GameSeatCancellationResult> {
  const locked = await client.query<LockedSeatRow>(
    `select os.id::text as open_seat_id, os.state as seat_state, g.state as game_state,
            os.creator_membership_id::text as creator_membership_id,
            os.intended_membership_id::text as intended_membership_id,
            actor.id::text as actor_membership_id
       from open_seats os
       join games g on g.id = os.game_id and g.house_id = os.house_id
       join houses h on h.id = os.house_id and h.status = 'active'
       join memberships actor
         on actor.house_id = os.house_id and actor.user_id = $3 and actor.status = 'active'
      where os.house_id = $1 and os.game_id = $2
      order by os.created_at desc
      limit 1
      for update of os, g`,
    [context.houseId, input.gameId, context.viewerId],
  );
  const row = locked.rows[0];
  if (row === undefined) throw new DomainError('not_found', 'Open seat is unavailable');
  const actor = text(row.actor_membership_id, 'actor membership id');
  const intended =
    row.intended_membership_id === null
      ? null
      : text(row.intended_membership_id, 'intended membership id');
  const cancelledBy =
    actor === text(row.creator_membership_id, 'creator membership id')
      ? 'creator'
      : intended === actor
        ? 'challenged'
        : null;
  if (cancelledBy === null) {
    throw new AuthorizationDeniedError(
      'Only the Member who opened the seat, or the Member it challenges, can cancel it',
    );
  }
  const result = {
    gameId: input.gameId,
    houseId: context.houseId,
    cancelledBy,
    state: 'cancelled',
  } as const;
  if (row.seat_state === 'cancelled' && row.game_state === 'cancelled') {
    return { ...result, cancelledNow: false };
  }
  if (row.seat_state === 'expired') throw new DomainError('not_found', 'Open seat has expired');
  if (row.seat_state !== 'open' || row.game_state !== 'waiting') {
    throw new DomainError('conflict', 'Open seat is already taken');
  }
  await client.query(`update open_seats set state = 'cancelled' where id = $1 and house_id = $2`, [
    text(row.open_seat_id, 'id'),
    context.houseId,
  ]);
  await client.query(
    `update games set state = 'cancelled' where id = $1 and house_id = $2 and state = 'waiting'`,
    [input.gameId, context.houseId],
  );
  return { ...result, cancelledNow: true };
}

/** [BM-022] [BM-023] House-scoped cancellation of one waiting Game and its Open seat. */
export class PgGameSeatCancellationRepository implements GameSeatCancellationRepository {
  constructor(private readonly database: Pool) {}

  async cancel(
    context: AuthorizationContext,
    input: GameSeatCancellationInput,
  ): Promise<GameSeatCancellationResult> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const result = await cancelInTransaction(client, context, input);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
