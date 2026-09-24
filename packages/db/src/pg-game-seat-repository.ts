import {
  DomainError,
  type AuthorizationContext,
  type GameSeatCreationInput,
  type GameSeatCreationRepository,
  type GameSeatCreationResult,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { parseGameSeatReplay, type GameSeatReplayRow } from './game-seat-row-parser';

interface CreatorRow extends QueryResultRow {
  readonly id: unknown;
}

interface MembershipRow extends QueryResultRow {
  readonly id: unknown;
}

interface SeasonRow extends QueryResultRow {
  readonly id: unknown;
  readonly correspondence_pace_hours: unknown;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Game seat ${field}`);
  return value;
}

async function findReplay(
  client: PoolClient,
  context: AuthorizationContext,
  creatorMembershipId: string,
  input: GameSeatCreationInput,
): Promise<GameSeatCreationResult | null> {
  if (input.idempotencyKey === null) return null;
  const result = await client.query<GameSeatReplayRow>(
    `select s.game_id::text, s.id::text as open_seat_id, g.season_id::text,
            s.creator_membership_id::text, s.intended_membership_id::text,
            s.offered_color,
            case when g.white_membership_id = s.creator_membership_id
                 then 'white' else 'black' end as creator_color,
            s.expires_at, s.creation_payload_digest,
            encode(digest($4, 'sha256'), 'hex') as expected_payload_digest
       from open_seats s
       join games g on g.id = s.game_id and g.house_id = s.house_id
      where s.house_id = $1 and s.creator_membership_id = $2
        and s.creation_idempotency_digest = encode(digest($3, 'sha256'), 'hex')
      limit 1`,
    [context.houseId, creatorMembershipId, input.idempotencyKey, input.idempotencyPayload],
  );
  const row = result.rows[0];
  return row === undefined ? null : parseGameSeatReplay(row, context.houseId);
}

async function createInTransaction(
  client: PoolClient,
  context: AuthorizationContext,
  input: GameSeatCreationInput,
): Promise<GameSeatCreationResult> {
  const creator = await client.query<CreatorRow>(
    `select id::text from memberships
      where house_id = $1 and user_id = $2 and status = 'active'`,
    [context.houseId, context.viewerId],
  );
  const creatorMembershipId = creator.rows[0]?.id;
  if (typeof creatorMembershipId !== 'string') {
    throw new DomainError('not_found', 'House membership is unavailable');
  }
  const membershipIds = [creatorMembershipId, input.intendedMembershipId]
    .filter((id): id is string => id !== null)
    .sort();
  const lockedMemberships = await client.query<MembershipRow>(
    `select id::text from memberships
      where house_id = $1 and status = 'active' and id = any($2::uuid[])
      order by id
      for update`,
    [context.houseId, membershipIds],
  );
  const lockedMembershipIds = new Set(
    lockedMemberships.rows.map((row) => stringValue(row.id, 'membership id')),
  );
  if (!lockedMembershipIds.has(creatorMembershipId)) {
    throw new DomainError('not_found', 'House membership is unavailable');
  }
  const replay = await findReplay(client, context, creatorMembershipId, input);
  if (replay !== null) return replay;
  if (input.intendedMembershipId === creatorMembershipId) {
    throw new DomainError('validation_failed', 'A Member cannot challenge themselves');
  }

  const season = await client.query<SeasonRow>(
    `select s.id::text, c.correspondence_pace_hours
       from seasons s
       join season_charters c
         on c.season_id = s.id and c.version = s.published_charter_version
      where s.house_id = $1 and s.state = 'active'
      for share of s, c`,
    [context.houseId],
  );
  const seasonRow = season.rows[0];
  if (seasonRow === undefined) throw new DomainError('conflict', 'House has no active Season');
  if (
    input.mode === 'correspondence' &&
    seasonRow.correspondence_pace_hours !== input.clockPolicy.perMoveHours
  ) {
    throw new DomainError('validation_failed', 'Clock policy must match the active Charter');
  }
  if (input.mode === 'live') {
    if (
      !Number.isInteger(input.clockPolicy.initialMs) ||
      input.clockPolicy.initialMs < 180_000 ||
      input.clockPolicy.initialMs > 2_147_483_647 ||
      !Number.isInteger(input.clockPolicy.incrementMs) ||
      input.clockPolicy.incrementMs < 0 ||
      input.clockPolicy.incrementMs > 2_147_483_647
    ) {
      throw new DomainError('validation_failed', 'Live clock control is invalid');
    }
    const night = await client.query<{ readonly season_id: string }>(
      `select season_id::text from house_nights
        where id=$1 and house_id=$2 and state='live' for share`,
      [input.nightId, context.houseId],
    );
    if (night.rows[0]?.season_id !== seasonRow.id) {
      throw new DomainError('conflict', 'Live Game requires an active Night in this Season');
    }
  }
  if (input.intendedMembershipId !== null && !lockedMembershipIds.has(input.intendedMembershipId)) {
    throw new DomainError('not_found', 'Intended Member is unavailable');
  }

  const whiteMembershipId = input.creatorColor === 'white' ? creatorMembershipId : null;
  const blackMembershipId = input.creatorColor === 'black' ? creatorMembershipId : null;
  await client.query(
    `insert into games
      (id, house_id, season_id, night_id, mode, state, white_membership_id, black_membership_id,
       clock_policy, white_clock_ms, black_clock_ms, created_at)
     values ($1, $2, $3, $4, $5, 'waiting', $6, $7, $8, $9, $9, $10)`,
    [
      input.gameId,
      context.houseId,
      stringValue(seasonRow.id, 'Season id'),
      input.mode === 'live' ? input.nightId : null,
      input.mode,
      whiteMembershipId,
      blackMembershipId,
      input.clockPolicy,
      input.mode === 'live' ? input.clockPolicy.initialMs : null,
      input.createdAt,
    ],
  );
  await client.query(
    `insert into open_seats
      (id, game_id, house_id, offered_color, creator_membership_id,
       intended_membership_id, state, expires_at, created_at,
       creation_idempotency_digest, creation_payload_digest)
     values ($1, $2, $3, $4, $5, $6, 'open', $7, $8,
       case when $9::text is null then null else encode(digest($9, 'sha256'), 'hex') end,
       case when $9::text is null then null else encode(digest($10, 'sha256'), 'hex') end)`,
    [
      input.openSeatId,
      input.gameId,
      context.houseId,
      input.offeredColor,
      creatorMembershipId,
      input.intendedMembershipId,
      input.expiresAt,
      input.createdAt,
      input.idempotencyKey,
      input.idempotencyPayload,
    ],
  );
  return {
    gameId: input.gameId,
    openSeatId: input.openSeatId,
    houseId: context.houseId,
    seasonId: stringValue(seasonRow.id, 'Season id'),
    creatorMembershipId,
    intendedMembershipId: input.intendedMembershipId,
    offeredColor: input.offeredColor,
    creatorColor: input.creatorColor,
    expiresAt: input.expiresAt,
    state: 'waiting',
    createdNow: true,
  };
}

/** [BM-022] House-scoped atomic Game/Open-seat transaction. */
export class PgGameSeatRepository implements GameSeatCreationRepository {
  constructor(private readonly database: Pool) {}

  async create(
    context: AuthorizationContext,
    input: GameSeatCreationInput,
  ): Promise<GameSeatCreationResult> {
    const client = await this.database.connect();
    try {
      await client.query('begin');
      const result = await createInTransaction(client, context, input);
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
