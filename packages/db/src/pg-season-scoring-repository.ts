import {
  DomainError,
  isWithinSeasonScoreCap,
  SEASON_RESULT_RECORDED_TOPIC,
  type AuthorizationContext,
  type CompletedGameScoringSource,
  type SeasonScoreAppendOutcome,
  type SeasonScoreLedgerCandidate,
  type SeasonScoreLedgerEntry,
  type SeasonScoreSourceKind,
  type SeasonScoringRepository,
  type SeasonStandings,
} from '@between-moves/domain';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';
import { readFinalStandings } from './pg-season-closing';

interface CompletedGameRow extends QueryResultRow {
  readonly game_id: unknown;
  readonly house_id: unknown;
  readonly season_id: unknown;
  readonly white_membership_id: unknown;
  readonly black_membership_id: unknown;
  readonly result: unknown;
}

interface LedgerRow extends QueryResultRow {
  readonly id: unknown;
  readonly house_id: unknown;
  readonly season_id: unknown;
  readonly membership_id: unknown;
  readonly source_kind: unknown;
  readonly source_key: unknown;
  readonly points: unknown;
  readonly created_at: unknown;
}

interface StandingRow extends QueryResultRow {
  readonly membership_id: unknown;
  readonly points: unknown;
}

const capPolicy = {
  games: { cap: 8, countedKinds: ['game_played', 'game_win', 'game_draw'] },
  nights: { cap: 4, countedKinds: ['night_attendance'] },
  puzzles: { cap: 2, countedKinds: ['puzzle_published'] },
} as const;

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid Season scoring ${field}`);
  return value;
}

function integerValue(value: unknown, field: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) {
    throw new Error(`Invalid Season scoring ${field}`);
  }
  return parsed;
}

function dateValue(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid Season scoring ${field}`);
  }
  return value;
}

function sourceKind(value: unknown): SeasonScoreSourceKind {
  if (
    value === 'game_played' ||
    value === 'game_win' ||
    value === 'game_draw' ||
    value === 'night_attendance' ||
    value === 'puzzle_published'
  ) {
    return value;
  }
  throw new Error('Invalid Season scoring source kind');
}

function parseLedger(row: LedgerRow): SeasonScoreLedgerEntry {
  return {
    id: stringValue(row.id, 'ledger id'),
    houseId: stringValue(row.house_id, 'House id'),
    seasonId: stringValue(row.season_id, 'Season id'),
    membershipId: stringValue(row.membership_id, 'membership id'),
    sourceKind: sourceKind(row.source_kind),
    sourceKey: stringValue(row.source_key, 'source key'),
    points: integerValue(row.points, 'points'),
    createdAt: dateValue(row.created_at, 'creation time'),
  };
}

function validateCandidate(entry: SeasonScoreLedgerCandidate): void {
  const policy = capPolicy[entry.capKind];
  const expectedPoints =
    entry.sourceKind === 'game_win' ? 3 : entry.sourceKind === 'game_draw' ? 2 : 1;
  if (
    entry.cap !== policy.cap ||
    !(policy.countedKinds as readonly string[]).includes(entry.sourceKind) ||
    entry.points !== expectedPoints ||
    entry.sourceId.length === 0 ||
    entry.sourceKey.length === 0 ||
    entry.capSourceKey.length === 0
  ) {
    throw new DomainError('validation_failed', 'Invalid fixed Season scoring award');
  }
}

async function gameSourceOrdinal(
  client: PoolClient,
  houseId: string,
  seasonId: string,
  entry: SeasonScoreLedgerCandidate,
): Promise<number> {
  const result = await client.query<{ ordinal: number }>(
    `select (
       select count(*)::int
         from games candidate
        where candidate.house_id=source.house_id
          and candidate.season_id=source.season_id
          and candidate.state='completed'
          and candidate.result in ('white_win','black_win','draw')
          and $4::uuid in (candidate.white_membership_id, candidate.black_membership_id)
          and candidate.season_completion_sequence <= source.season_completion_sequence
     ) as ordinal
       from games source
      where source.id=$3 and source.house_id=$1 and source.season_id=$2
        and source.state='completed' and source.result in ('white_win','black_win','draw')
        and source.completed_at is not null
        and source.season_completion_sequence is not null
        and $4::uuid in (source.white_membership_id, source.black_membership_id)`,
    [houseId, seasonId, entry.sourceId, entry.membershipId],
  );
  const ordinal = result.rows[0]?.ordinal;
  if (ordinal === undefined || !Number.isInteger(ordinal)) {
    throw new DomainError('validation_failed', 'Completed Game scoring source is unavailable');
  }
  return ordinal;
}

async function inTransaction<T>(database: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query('begin');
    const result = await operation(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function groupedEntries(entries: readonly SeasonScoreLedgerCandidate[]) {
  const groups = new Map<string, SeasonScoreLedgerCandidate[]>();
  for (const entry of entries) {
    validateCandidate(entry);
    const key = `${entry.membershipId}\u0000${entry.capSourceKey}`;
    const group = groups.get(key) ?? [];
    if (group.length !== 0) {
      throw new DomainError(
        'validation_failed',
        'A scoring source must create one ledger entry per Member',
      );
    }
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function lockScope(
  client: PoolClient,
  houseId: string,
  seasonId: string,
  membershipIds: readonly string[],
): Promise<void> {
  // Game completion locks its actor membership before allocating the Season
  // sequence. Keep that same Member -> Season order to avoid a lock cycle.
  const memberships = await client.query<{ id: string }>(
    `select id::text from memberships
      where house_id=$1 and id=any($2::uuid[]) order by id for update`,
    [houseId, membershipIds],
  );
  if (memberships.rowCount !== membershipIds.length) {
    throw new DomainError('not_found', 'Season scoring membership is unavailable');
  }

  const season = await client.query(
    `select 1 from seasons
      where id=$1 and house_id=$2 and state in ('active','closing','closed') for update`,
    [seasonId, houseId],
  );
  if (season.rowCount !== 1) throw new DomainError('not_found', 'Season is unavailable');
}

async function appendGroup(
  client: PoolClient,
  houseId: string,
  seasonId: string,
  entries: readonly SeasonScoreLedgerCandidate[],
  createdAt: Date,
): Promise<{ outcome: SeasonScoreAppendOutcome; entries: SeasonScoreLedgerEntry[] }> {
  const first = entries[0];
  if (first === undefined) return { outcome: 'duplicate', entries: [] };
  const existing = await client.query(
    `select 1 from season_score_ledger
      where season_id=$1 and membership_id=$2 and source_key=$3`,
    [seasonId, first.membershipId, first.capSourceKey],
  );
  if (existing.rowCount !== 0) return { outcome: 'duplicate', entries: [] };

  const policy = capPolicy[first.capKind];
  if (first.capKind === 'games') {
    const ordinal = await gameSourceOrdinal(client, houseId, seasonId, first);
    if (!isWithinSeasonScoreCap('games', ordinal)) return { outcome: 'capped', entries: [] };
  } else {
    const count = await client.query<{ count: number }>(
      `select count(*)::int as count from season_score_ledger
        where season_id=$1 and membership_id=$2 and source_kind=any($3::text[])`,
      [seasonId, first.membershipId, policy.countedKinds],
    );
    if ((count.rows[0]?.count ?? 0) >= policy.cap) return { outcome: 'capped', entries: [] };
  }

  const inserted: SeasonScoreLedgerEntry[] = [];
  for (const entry of entries) {
    const result = await client.query<LedgerRow>(
      `insert into season_score_ledger
        (id, house_id, season_id, membership_id, source_kind, source_key, points, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (season_id, membership_id, source_key) do nothing
       returning id::text, house_id::text, season_id::text, membership_id::text,
                 source_kind, source_key, points, created_at`,
      [
        entry.id,
        houseId,
        seasonId,
        entry.membershipId,
        entry.sourceKind,
        entry.sourceKey,
        entry.points,
        createdAt,
      ],
    );
    if (result.rows[0] !== undefined) inserted.push(parseLedger(result.rows[0]));
  }
  if (inserted.length !== entries.length) {
    throw new Error('Season scoring source was only partially recorded');
  }
  return { outcome: 'recorded', entries: inserted };
}

async function enqueueScoringResult(
  client: PoolClient,
  input: Parameters<SeasonScoringRepository['append']>[0],
  entries: readonly SeasonScoreLedgerEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const sequence = await client.query<{ value: string }>(
    `update seasons set outbox_sequence=outbox_sequence+1, updated_at=$3
      where id=$1 and house_id=$2 returning outbox_sequence::text as value`,
    [input.seasonId, input.houseId, input.recordedAt],
  );
  const value = sequence.rows[0]?.value;
  if (value === undefined) throw new Error('Season scoring outbox sequence is unavailable');
  const sourceId = input.entries[0]?.sourceId;
  if (sourceId === undefined) throw new Error('Season scoring source is unavailable');
  await enqueueOutboxEvent(
    {
      id: input.resultEventId,
      topic: SEASON_RESULT_RECORDED_TOPIC,
      aggregateId: input.seasonId,
      sequence: BigInt(value),
      houseId: input.houseId,
      payload: {
        sourceEventId: input.sourceEventId,
        sourceTopic: input.sourceTopic,
        sourceId,
        ...(input.sourceTopic === 'game.completed' ? { gameId: sourceId } : {}),
        entries: entries.map((entry) => ({
          membershipId: entry.membershipId,
          sourceKind: entry.sourceKind,
          points: entry.points,
        })),
      },
      availableAt: input.recordedAt,
      occurredAt: input.recordedAt,
    },
    client,
  );
}

/** [BM-034] [DR-SCORE-01..08] PostgreSQL ledger, cap, source, and standings adapter. */
export class PgSeasonScoringRepository implements SeasonScoringRepository {
  constructor(private readonly database: Pool) {}

  async findCompletedGame(
    houseId: string,
    gameId: string,
  ): Promise<CompletedGameScoringSource | null> {
    const result = await this.database.query<CompletedGameRow>(
      `select id::text as game_id, house_id::text, season_id::text,
              white_membership_id::text, black_membership_id::text, result
         from games
        where id=$1 and house_id=$2 and state='completed'
          and white_membership_id is not null and black_membership_id is not null
          and result in ('white_win','black_win','draw')`,
      [gameId, houseId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const resultValue = row.result;
    if (resultValue !== 'white_win' && resultValue !== 'black_win' && resultValue !== 'draw') {
      throw new Error('Invalid completed Game scoring result');
    }
    return {
      gameId: stringValue(row.game_id, 'Game id'),
      houseId: stringValue(row.house_id, 'House id'),
      seasonId: stringValue(row.season_id, 'Season id'),
      whiteMembershipId: stringValue(row.white_membership_id, 'white membership id'),
      blackMembershipId: stringValue(row.black_membership_id, 'black membership id'),
      result: resultValue,
    };
  }

  async findSeasonAt(houseId: string, occurredAt: Date): Promise<string | null> {
    const result = await this.database.query<{ id: unknown }>(
      `select id::text from seasons
        where house_id=$1 and state in ('active','closing','closed')
          and starts_at <= $2 and ends_at >= $2
        order by starts_at desc, id desc limit 1`,
      [houseId, occurredAt],
    );
    return result.rows[0] === undefined ? null : stringValue(result.rows[0].id, 'Season id');
  }

  async append(input: Parameters<SeasonScoringRepository['append']>[0]) {
    if (Number.isNaN(input.createdAt.getTime()) || Number.isNaN(input.recordedAt.getTime())) {
      throw new DomainError('validation_failed', 'Invalid Season scoring timestamp');
    }
    if (input.entries.length === 0) return { outcome: 'duplicate' as const, entries: [] };
    if (new Set(input.entries.map((entry) => entry.sourceId)).size !== 1) {
      throw new DomainError('validation_failed', 'A scoring event must have one source');
    }
    const groups = groupedEntries(input.entries);
    const membershipIds = [...new Set(input.entries.map((entry) => entry.membershipId))].sort();
    return inTransaction(this.database, async (client) => {
      await lockScope(client, input.houseId, input.seasonId, membershipIds);
      const results: Array<{
        outcome: SeasonScoreAppendOutcome;
        entries: SeasonScoreLedgerEntry[];
      }> = [];
      for (const group of groups) {
        results.push(
          await appendGroup(client, input.houseId, input.seasonId, group, input.createdAt),
        );
      }
      const entries = results.flatMap((result) => result.entries);
      const outcome: SeasonScoreAppendOutcome = results.some(
        (result) => result.outcome === 'recorded',
      )
        ? 'recorded'
        : results.some((result) => result.outcome === 'capped')
          ? 'capped'
          : 'duplicate';
      await enqueueScoringResult(client, input, entries);
      return { outcome, entries };
    });
  }

  /**
   * Return live ledger totals, or the frozen snapshot with `finalized: true` for a closing
   * or closed Season. Return null if the Season is unavailable to an active House Member.
   * Database and row-validation failures propagate.
   */
  async readStandings(
    context: AuthorizationContext,
    seasonId: string,
  ): Promise<SeasonStandings | null> {
    const authorized = await this.database.query<{ state: unknown }>(
      `select s.state from seasons s
        join houses h on h.id=s.house_id and h.status='active'
        join memberships viewer on viewer.house_id=s.house_id
          and viewer.user_id=$3 and viewer.status='active'
       where s.id=$1 and s.house_id=$2`,
      [seasonId, context.houseId, context.viewerId],
    );
    const season = authorized.rows[0];
    if (season === undefined) return null;
    if (season.state === 'closing' || season.state === 'closed') {
      const standings = await readFinalStandings(this.database, context.houseId, seasonId);
      return {
        houseId: context.houseId,
        seasonId,
        finalized: true,
        standings: standings.map(({ membershipId, points }) => ({ membershipId, points })),
      };
    }
    const result = await this.database.query<StandingRow>(
      `select membership_id::text, sum(points)::int as points
         from season_score_ledger
        where house_id=$1 and season_id=$2
        group by membership_id
        order by sum(points) desc, membership_id`,
      [context.houseId, seasonId],
    );
    return {
      houseId: context.houseId,
      seasonId,
      finalized: false,
      standings: result.rows.map((row) => ({
        membershipId: stringValue(row.membership_id, 'membership id'),
        points: integerValue(row.points, 'standing points'),
      })),
    };
  }
}
