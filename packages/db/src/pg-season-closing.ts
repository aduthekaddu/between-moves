import {
  rankFinalStandings,
  SEASON_CLOSING_TOPIC,
  type AuthorizationContext,
  type ClosedSeasonView,
  type FinalSeasonStanding,
  type RankedSeasonStanding,
  type SeasonClosingInput,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';

type Queryable = Pick<Pool | PoolClient, 'query'>;

interface StandingRow extends QueryResultRow {
  readonly membership_id: unknown;
  readonly points: unknown;
  readonly rank?: unknown;
  readonly display_name?: unknown;
}

interface ClosedSeasonRow extends QueryResultRow {
  readonly id: unknown;
  readonly title: unknown;
  readonly state: unknown;
  readonly starts_at: unknown;
  readonly ends_at: unknown;
  readonly closed_at: unknown;
}

/** Return a string unchanged, or throw an Error identifying the invalid database field. */
function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Season closing ${field}`);
  return value;
}

/** Return an integer unchanged, or throw an Error identifying the invalid database field. */
function integerValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid Season closing ${field}`);
  }
  return value;
}

/** Return the same valid Date instance, or throw an Error identifying the invalid field. */
export function closingDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid Season closing ${field}`);
  }
  return value;
}

/**
 * [BM-047] Ledger totals for every Member who scored plus every active Member at close, so
 * a Member with no points still appears in the final table.
 */
async function ledgerTotals(
  client: PoolClient,
  houseId: string,
  seasonId: string,
): Promise<readonly RankedSeasonStanding[]> {
  const result = await client.query<StandingRow>(
    `select m.id::text as membership_id, coalesce(sum(l.points), 0)::int as points
       from memberships m
       left join season_score_ledger l
         on l.membership_id = m.id and l.house_id = m.house_id and l.season_id = $2
      where m.house_id = $1
      group by m.id, m.status
     having m.status = 'active' or count(l.id) > 0`,
    [houseId, seasonId],
  );
  return rankFinalStandings(
    result.rows.map((row) => ({
      membershipId: stringValue(row.membership_id, 'membership id'),
      points: integerValue(row.points, 'points'),
    })),
  );
}

/**
 * Read the snapshot by rank, then membership ID; return an empty array if none exists.
 * The caller must authorize access. Query failures and invalid database fields propagate.
 */
export async function readFinalStandings(
  database: Queryable,
  houseId: string,
  seasonId: string,
): Promise<readonly RankedSeasonStanding[]> {
  const result = await database.query<StandingRow>(
    `select membership_id::text, points, rank
       from season_final_standings
      where house_id = $1 and season_id = $2
      order by rank, membership_id`,
    [houseId, seasonId],
  );
  return result.rows.map((row) => ({
    membershipId: stringValue(row.membership_id, 'membership id'),
    points: integerValue(row.points, 'points'),
    rank: integerValue(row.rank, 'rank'),
  }));
}

/**
 * [BM-047] Snapshot standings, mark the Season closing, and enqueue `season.closing`.
 * Use the caller's transaction after it has authorized and locked the active Season.
 * Return the ranked snapshot, including active Members with zero points. `closingAt` timestamps
 * the snapshot, state change, and event; `actorMembershipId` identifies the actor in the event.
 * Query and row-validation failures propagate; throw if the active Season cannot be updated.
 */
export async function snapshotAndEnqueueClosing(
  client: PoolClient,
  context: AuthorizationContext,
  input: SeasonClosingInput,
  actorMembershipId: string,
): Promise<readonly RankedSeasonStanding[]> {
  const standings = await ledgerTotals(client, context.houseId, input.seasonId);
  for (const standing of standings) {
    await client.query(
      `insert into season_final_standings
        (season_id, house_id, membership_id, rank, points, finalized_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        input.seasonId,
        context.houseId,
        standing.membershipId,
        standing.rank,
        standing.points,
        input.closingAt,
      ],
    );
  }
  const sequence = await client.query<{ value: string }>(
    `update seasons
        set state = 'closing', outbox_sequence = outbox_sequence + 1, updated_at = $3
      where id = $1 and house_id = $2 and state = 'active'
      returning outbox_sequence::text as value`,
    [input.seasonId, context.houseId, input.closingAt],
  );
  const value = sequence.rows[0]?.value;
  if (value === undefined) throw new Error('Season closing sequence is unavailable');
  await enqueueOutboxEvent(
    {
      id: input.closingEventId,
      topic: SEASON_CLOSING_TOPIC,
      aggregateId: input.seasonId,
      sequence: BigInt(value),
      houseId: context.houseId,
      payload: {
        seasonId: input.seasonId,
        actorMembershipId,
        closingAt: input.closingAt.toISOString(),
        standings: standings.map((standing) => ({
          membershipId: standing.membershipId,
          rank: standing.rank,
          points: standing.points,
        })),
      },
      availableAt: input.closingAt,
      occurredAt: input.closingAt,
    },
    client,
  );
  return standings;
}

/**
 * [BM-047] Latest Season with frozen standings plus named standings for an active House Member.
 * A Season still `closing` wins (at most one exists per House); otherwise select by close time,
 * then Season ID, descending. Order standings by rank, name, then ID.
 * Return null if the House or membership is inactive or no Season has frozen standings.
 * Query failures and invalid database fields propagate.
 */
export async function readLatestClosedSeason(
  database: Pool,
  context: AuthorizationContext,
): Promise<ClosedSeasonView | null> {
  const season = await database.query<ClosedSeasonRow>(
    `select s.id::text, s.title, s.state, s.starts_at, s.ends_at, s.closed_at
       from seasons s
       join houses h on h.id = s.house_id and h.status = 'active'
       join memberships viewer
         on viewer.house_id = s.house_id
        and viewer.user_id = $2
        and viewer.status = 'active'
      where s.house_id = $1 and s.state in ('closing', 'closed')
      order by s.state = 'closing' desc, s.closed_at desc, s.id desc
      limit 1`,
    [context.houseId, context.viewerId],
  );
  const row = season.rows[0];
  if (row === undefined) return null;
  const seasonId = stringValue(row.id, 'Season id');
  const state = row.state;
  if (state !== 'closing' && state !== 'closed') throw new Error('Invalid Season closing state');
  const standings = await database.query<StandingRow>(
    `select f.membership_id::text, f.points, f.rank,
            coalesce(m.display_name_snapshot, u.display_name) as display_name
       from season_final_standings f
       join memberships m on m.id = f.membership_id and m.house_id = f.house_id
       join users u on u.id = m.user_id
      where f.house_id = $1 and f.season_id = $2
      order by f.rank, display_name, f.membership_id`,
    [context.houseId, seasonId],
  );
  return {
    seasonId,
    title: stringValue(row.title, 'title'),
    state,
    startsAt: closingDate(row.starts_at, 'start'),
    endsAt: closingDate(row.ends_at, 'end'),
    closedAt: state === 'closed' ? closingDate(row.closed_at, 'closed time') : null,
    standings: standings.rows.map((standing): FinalSeasonStanding => ({
      membershipId: stringValue(standing.membership_id, 'membership id'),
      displayName: stringValue(standing.display_name, 'display name'),
      points: integerValue(standing.points, 'points'),
      rank: integerValue(standing.rank, 'rank'),
    })),
  };
}
