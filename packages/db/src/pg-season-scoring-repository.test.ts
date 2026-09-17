import {
  nightAttendanceScore,
  scoreCompletedGame,
  type SeasonScoreLedgerCandidate,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PgSeasonScoringRepository } from './pg-season-scoring-repository';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const seasonId = '01941f29-7c00-7000-8000-000000000691';
const gameId = '01941f29-7c00-7000-8000-000000000701';
const whiteMembershipId = '01941f29-7c00-8000-000000000621';
const blackMembershipId = '01941f29-7c00-8000-000000000623';
const occurredAt = new Date('2026-09-12T12:00:00.000Z');

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function gameEntries(): SeasonScoreLedgerCandidate[] {
  return scoreCompletedGame({
    gameId,
    houseId,
    seasonId,
    whiteMembershipId,
    blackMembershipId,
    result: 'white_win',
  }).map((award, index) => ({ ...award, id: id(800 + index) }));
}

function appendInput(entries: readonly SeasonScoreLedgerCandidate[]) {
  return {
    houseId,
    seasonId,
    entries,
    createdAt: occurredAt,
    recordedAt: occurredAt,
    resultEventId: id(850),
    sourceEventId: id(851),
    sourceTopic: 'game.completed',
  };
}

interface TransactionOptions {
  readonly ordinal?: number;
  readonly existing?: number;
  readonly count?: number;
  readonly sequence?: string;
  readonly insertRows?: boolean;
}

function transactionDatabase(options: TransactionOptions = {}) {
  const clientQuery = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('from memberships')) {
      const ids = Array.isArray(values[1]) ? values[1] : [];
      return { rows: ids.map((idValue) => ({ id: idValue })), rowCount: ids.length };
    }
    if (sql.includes('from seasons') && sql.includes('for update')) {
      return { rows: [{}], rowCount: 1 };
    }
    if (sql.includes('from season_score_ledger') && sql.includes('source_key=$3')) {
      return { rows: [], rowCount: options.existing ?? 0 };
    }
    if (sql.includes('select (')) {
      return { rows: [{ ordinal: options.ordinal ?? 1 }], rowCount: 1 };
    }
    if (sql.includes('count(*)::int as count')) {
      return { rows: [{ count: options.count ?? 0 }], rowCount: 1 };
    }
    if (sql.includes('insert into season_score_ledger')) {
      if (options.insertRows === false) return { rows: [], rowCount: 0 };
      const [entryId, entryHouseId, entrySeasonId, membershipId, sourceKind, sourceKey, points] =
        values;
      return {
        rows: [
          {
            id: entryId,
            house_id: entryHouseId,
            season_id: entrySeasonId,
            membership_id: membershipId,
            source_kind: sourceKind,
            source_key: sourceKey,
            points,
            created_at: occurredAt,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes('update seasons set outbox_sequence')) {
      return { rows: [{ value: options.sequence ?? '1' }], rowCount: 1 };
    }
    if (sql.includes('insert into outbox_events')) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled test query: ${sql}`);
  });
  const release = vi.fn();
  const client = { query: clientQuery, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect } as unknown as Pool;
  return { pool, clientQuery, connect, release };
}

function queryPool(query: ReturnType<typeof vi.fn>): Pool {
  return { query } as unknown as Pool;
}

describe('BM-034 PostgreSQL Season scoring repository', () => {
  it('maps a completed Game and preserves House scope', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          game_id: gameId,
          house_id: houseId,
          season_id: seasonId,
          white_membership_id: whiteMembershipId,
          black_membership_id: blackMembershipId,
          result: 'white_win',
        },
      ],
    });

    await expect(
      new PgSeasonScoringRepository(queryPool(query)).findCompletedGame(houseId, gameId),
    ).resolves.toEqual({
      gameId,
      houseId,
      seasonId,
      whiteMembershipId,
      blackMembershipId,
      result: 'white_win',
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("state='completed'"), [
      gameId,
      houseId,
    ]);
  });

  it('returns null for unavailable source and Season rows', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new PgSeasonScoringRepository(queryPool(query));

    await expect(repository.findCompletedGame(houseId, gameId)).resolves.toBeNull();
    await expect(repository.findSeasonAt(houseId, occurredAt)).resolves.toBeNull();
  });

  it('maps a Season active at the event instant', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: seasonId }], rowCount: 1 });

    await expect(
      new PgSeasonScoringRepository(queryPool(query)).findSeasonAt(houseId, occurredAt),
    ).resolves.toBe(seasonId);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('starts_at <= $2'), [
      houseId,
      occurredAt,
    ]);
  });

  it('records a Game recipe atomically and emits one Season result event', async () => {
    const database = transactionDatabase();
    const result = await new PgSeasonScoringRepository(database.pool).append(
      appendInput(gameEntries()),
    );

    expect(result).toMatchObject({ outcome: 'recorded' });
    expect(result.entries).toHaveLength(2);
    expect(database.clientQuery).toHaveBeenCalledWith('begin');
    expect(database.clientQuery).toHaveBeenCalledWith('commit');
    expect(database.release).toHaveBeenCalledOnce();
    const eventCall = database.clientQuery.mock.calls.find(([sql]) =>
      sql.includes('insert into outbox_events'),
    );
    expect(eventCall?.[1]?.[5]).toContain('gameId');
  });

  it('returns duplicate and capped outcomes without writing ledger rows', async () => {
    const duplicate = transactionDatabase({ existing: 1 });
    await expect(
      new PgSeasonScoringRepository(duplicate.pool).append(
        appendInput([gameEntries()[0] as SeasonScoreLedgerCandidate]),
      ),
    ).resolves.toMatchObject({ outcome: 'duplicate', entries: [] });

    const capped = transactionDatabase({ ordinal: 9 });
    await expect(
      new PgSeasonScoringRepository(capped.pool).append(
        appendInput([gameEntries()[0] as SeasonScoreLedgerCandidate]),
      ),
    ).resolves.toMatchObject({ outcome: 'capped', entries: [] });
    expect(
      capped.clientQuery.mock.calls.some(([sql]) =>
        sql.includes('insert into season_score_ledger'),
      ),
    ).toBe(false);
  });

  it('applies the Night cap query and rolls back partial inserts', async () => {
    const award = nightAttendanceScore(id(900), whiteMembershipId);
    const recorded = transactionDatabase({ count: 0 });
    await expect(
      new PgSeasonScoringRepository(recorded.pool).append(appendInput([{ ...award, id: id(901) }])),
    ).resolves.toMatchObject({ outcome: 'recorded' });

    const capped = transactionDatabase({ count: 4 });
    await expect(
      new PgSeasonScoringRepository(capped.pool).append(appendInput([{ ...award, id: id(902) }])),
    ).resolves.toMatchObject({ outcome: 'capped' });

    const partial = transactionDatabase({ insertRows: false });
    await expect(
      new PgSeasonScoringRepository(partial.pool).append(appendInput([{ ...award, id: id(903) }])),
    ).rejects.toThrow('only partially recorded');
    expect(partial.clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('rejects malformed scoring input before opening a transaction', async () => {
    const database = transactionDatabase();
    const award = gameEntries()[0] as SeasonScoreLedgerCandidate;

    await expect(
      new PgSeasonScoringRepository(database.pool).append({
        ...appendInput([{ ...award, id: id(910), cap: 99 }]),
        createdAt: new Date('invalid'),
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(database.connect).not.toHaveBeenCalled();

    await expect(
      new PgSeasonScoringRepository(database.pool).append({
        ...appendInput([
          { ...award, id: id(911) },
          {
            ...nightAttendanceScore(id(912), whiteMembershipId),
            id: id(913),
          },
        ]),
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('hides unauthorized standings and maps authorized totals', async () => {
    const context = fakeAuthorizationContext({ houseId, viewerId: id(950) });
    const unauthorizedQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(
      new PgSeasonScoringRepository(queryPool(unauthorizedQuery)).readStandings(context, seasonId),
    ).resolves.toBeNull();

    const authorizedQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ membership_id: whiteMembershipId, points: '17' }],
        rowCount: 1,
      });
    await expect(
      new PgSeasonScoringRepository(queryPool(authorizedQuery)).readStandings(context, seasonId),
    ).resolves.toEqual({
      houseId,
      seasonId,
      standings: [{ membershipId: whiteMembershipId, points: 17 }],
    });
  });

  it('rejects malformed database rows', async () => {
    const invalidResult = vi.fn().mockResolvedValue({
      rows: [{ game_id: gameId, house_id: houseId, season_id: seasonId, result: 'aborted' }],
      rowCount: 1,
    });
    await expect(
      new PgSeasonScoringRepository(queryPool(invalidResult)).findCompletedGame(houseId, gameId),
    ).rejects.toThrow('Invalid completed Game scoring result');

    const invalidStanding = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ membership_id: 42, points: 1 }], rowCount: 1 });
    await expect(
      new PgSeasonScoringRepository(queryPool(invalidStanding)).readStandings(
        fakeAuthorizationContext({ houseId, viewerId: id(951) }),
        seasonId,
      ),
    ).rejects.toThrow('Invalid Season scoring membership id');
  });
});
