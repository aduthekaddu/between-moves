import {
  nightAttendanceScore,
  publishedPuzzleScore,
  scoreCompletedGame,
  type SeasonScoreAward,
} from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgGameCompletionRepository } from './pg-game-completion-repository';
import { PgSeasonScoringRepository } from './pg-season-scoring-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const seasonId = '01941f29-7c00-7000-8000-000000001701';
const charterId = '01941f29-7c00-7000-8000-000000001702';
const startedAt = new Date('2026-09-01T00:00:00.000Z');

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

integration('PostgreSQL Season scoring ledger', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 12 });
  const repository = new PgSeasonScoringRepository(database);
  let world: TwoHousesWithMembers;
  let nextEntryId = 2_000;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await database.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1,$2,'Scoring season','draft',$3,$3)`,
      [seasonId, world.first.houseId, startedAt],
    );
    await database.query(
      `insert into season_charters
        (id, season_id, version, correspondence_pace_hours, night_recurrence,
         points_recipe, published_at, created_at)
       values ($1,$2,1,24,'{"weekday":2,"localTime":"19:30","count":4}',
               '{"completedGame":1,"win":2,"draw":1,"nightAttendance":1,
                 "publishedPuzzle":1,"caps":{"games":8,"nights":4,"puzzles":2}}',
               $3,$3)`,
      [charterId, seasonId, startedAt],
    );
    await database.query(
      `update seasons set state='active', starts_at=$2, ends_at=$3,
              published_charter_version=1, updated_at=$2 where id=$1`,
      [seasonId, startedAt, new Date('2026-09-29T00:00:00.000Z')],
    );
    nextEntryId = 2_000;
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  async function append(
    awardInput: readonly SeasonScoreAward[] | SeasonScoreAward,
    at = startedAt,
  ) {
    const awards = Array.isArray(awardInput) ? awardInput : [awardInput];
    return repository.append({
      houseId: world.first.houseId,
      seasonId,
      entries: awards.map((award) => ({ ...award, id: id(nextEntryId++) })),
      createdAt: at,
      recordedAt: at,
      resultEventId: id(nextEntryId++),
      sourceEventId: id(nextEntryId++),
      sourceTopic: awards[0]?.sourceKind.startsWith('game_')
        ? 'game.completed'
        : awards[0]?.sourceKind === 'night_attendance'
          ? 'night.attendance-qualified'
          : 'puzzle.published',
    });
  }

  async function seedCompletedGame(
    gameId: string,
    completedAt: Date,
    result: 'white_win' | 'black_win' | 'draw',
  ): Promise<void> {
    await database.query(
      `with completion as (
         update seasons
            set game_completion_sequence=game_completion_sequence+1
          where id=$3 and house_id=$2
          returning game_completion_sequence
       )
       insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         result, result_reason, clock_policy, move_due_at, created_at, completed_at,
         season_completion_sequence)
       values ($1,$2,$3,'correspondence','completed',$4,$5,$6,$7,
               '{"kind":"correspondence","perMoveHours":24}',$8,$8,$8,
               (select game_completion_sequence from completion))`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        result,
        result === 'draw' ? 'agreement' : 'checkmate',
        completedAt,
      ],
    );
  }

  it('[BM-034] [DR-SCORE-01..08] applies the recipe and all caps to an immutable ledger', async () => {
    for (let game = 0; game < 9; game += 1) {
      const gameId = id(2_100 + game);
      await seedCompletedGame(gameId, new Date(startedAt.getTime() + game * 1_000), 'white_win');
      await append(
        scoreCompletedGame({
          gameId,
          houseId: world.first.houseId,
          seasonId,
          whiteMembershipId: world.first.member.membershipId,
          blackMembershipId: world.first.nonOwner.membershipId,
          result: 'white_win',
        }),
      );
    }
    for (let night = 0; night < 5; night += 1) {
      await append(nightAttendanceScore(id(2_200 + night), world.first.member.membershipId));
    }
    for (let puzzle = 0; puzzle < 3; puzzle += 1) {
      await append(publishedPuzzleScore(id(2_300 + puzzle), world.first.member.membershipId));
    }

    await expect(
      repository.readStandings(
        fakeAuthorizationContext({
          houseId: world.first.houseId,
          viewerId: world.first.member.userId,
        }),
        seasonId,
      ),
    ).resolves.toEqual({
      houseId: world.first.houseId,
      seasonId,
      finalized: false,
      standings: [
        { membershipId: world.first.member.membershipId, points: 30 },
        { membershipId: world.first.nonOwner.membershipId, points: 8 },
      ],
    });
    await expect(
      database.query(
        `select source_kind, count(*)::int as count from season_score_ledger
          group by source_kind order by source_kind`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { source_kind: 'game_played', count: 8 },
        { source_kind: 'game_win', count: 8 },
        { source_kind: 'night_attendance', count: 4 },
        { source_kind: 'puzzle_published', count: 2 },
      ],
    });
    await expect(
      database.query(
        `select count(*)::int as count from outbox_events
          where aggregate_id=$1 and topic='season.result-recorded'`,
        [seasonId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 14 }] });
    await expect(
      database.query(
        `select payload from outbox_events
          where aggregate_id=$1 and topic='season.result-recorded'
          order by sequence limit 1`,
        [seasonId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          payload: {
            gameId: id(2_100),
            sourceId: id(2_100),
            sourceTopic: 'game.completed',
            entries: expect.arrayContaining([
              {
                membershipId: world.first.member.membershipId,
                sourceKind: 'game_win',
                points: 3,
              },
            ]),
          },
        },
      ],
    });
    await expect(
      database.query('update season_score_ledger set points=99 where season_id=$1', [seasonId]),
    ).rejects.toThrow('season_score_ledger is immutable');
  });

  it('[BM-034] [DR-SCORE-08] serializes duplicate source keys under concurrency', async () => {
    const award = nightAttendanceScore(id(2_401), world.first.member.membershipId);
    const results = await Promise.all([
      repository.append({
        houseId: world.first.houseId,
        seasonId,
        entries: [{ ...award, id: id(2_402) }],
        createdAt: startedAt,
        recordedAt: startedAt,
        resultEventId: id(2_404),
        sourceEventId: id(2_405),
        sourceTopic: 'night.attendance-qualified',
      }),
      repository.append({
        houseId: world.first.houseId,
        seasonId,
        entries: [{ ...award, id: id(2_403) }],
        createdAt: startedAt,
        recordedAt: startedAt,
        resultEventId: id(2_406),
        sourceEventId: id(2_407),
        sourceTopic: 'night.attendance-qualified',
      }),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(['duplicate', 'recorded']);
    await expect(
      database.query('select count(*)::int as count from season_score_ledger where source_key=$1', [
        award.sourceKey,
      ]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('[BM-034] [DR-SCORE-04] never exceeds a cap when distinct sources race', async () => {
    for (let game = 0; game < 7; game += 1) {
      const gameId = id(2_500 + game);
      await seedCompletedGame(gameId, new Date(startedAt.getTime() + game * 1_000), 'draw');
      await append(
        scoreCompletedGame({
          gameId,
          houseId: world.first.houseId,
          seasonId,
          whiteMembershipId: world.first.member.membershipId,
          blackMembershipId: world.first.nonOwner.membershipId,
          result: 'draw',
        }).filter((award) => award.membershipId === world.first.member.membershipId),
      );
    }
    const racingGameIds = [id(2_510), id(2_511)];
    await seedCompletedGame(racingGameIds[0]!, new Date(startedAt.getTime() + 7_000), 'white_win');
    await seedCompletedGame(racingGameIds[1]!, new Date(startedAt.getTime() + 8_000), 'white_win');
    const racingAwards = racingGameIds.map((gameId) =>
      scoreCompletedGame({
        gameId,
        houseId: world.first.houseId,
        seasonId,
        whiteMembershipId: world.first.member.membershipId,
        blackMembershipId: world.first.nonOwner.membershipId,
        result: 'white_win',
      }).filter((award) => award.membershipId === world.first.member.membershipId),
    );

    const results = await Promise.all(racingAwards.map((awards) => append(awards)));

    expect(results.map((result) => result.outcome).sort()).toEqual(['capped', 'recorded']);
    await expect(
      database.query(
        `select count(*)::int as count from season_score_ledger
          where season_id=$1 and membership_id=$2
            and source_kind in ('game_played','game_win','game_draw')`,
        [seasonId, world.first.member.membershipId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 8 }] });
  });

  it('[BM-034] preserves Member-to-Season lock order when scoring races completion', async () => {
    const activeGameId = id(2_550);
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, move_due_at, created_at)
       values ($1,$2,$3,'correspondence','active',$4,$5,
               '{"kind":"correspondence","perMoveHours":24}',$6,$6)`,
      [
        activeGameId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        startedAt,
      ],
    );
    const completion = new PgGameCompletionRepository(database);
    const award = nightAttendanceScore(id(2_551), world.first.member.membershipId);

    const [scoringResult, completionResult] = await Promise.all([
      append(award),
      completion.resign(
        fakeAuthorizationContext({
          houseId: world.first.houseId,
          viewerId: world.first.member.userId,
        }),
        {
          gameId: activeGameId,
          clientCommandId: id(2_552),
          completedEventId: id(2_553),
          analysisEventId: id(2_554),
          completedAt: startedAt,
        },
      ),
    ]);

    expect(scoringResult.outcome).toBe('recorded');
    expect(completionResult).toMatchObject({ completedNow: true, result: 'black_win' });
  });

  it('[BM-034] resolves completed Games and the Season active at a Puzzle event instant', async () => {
    const gameId = id(2_601);
    await seedCompletedGame(gameId, startedAt, 'draw');

    await expect(repository.findCompletedGame(world.first.houseId, gameId)).resolves.toEqual({
      gameId,
      houseId: world.first.houseId,
      seasonId,
      whiteMembershipId: world.first.member.membershipId,
      blackMembershipId: world.first.nonOwner.membershipId,
      result: 'draw',
    });
    await expect(
      repository.findSeasonAt(world.first.houseId, new Date('2026-09-12T00:00:00.000Z')),
    ).resolves.toBe(seasonId);
  });

  it('[BM-034] [DR-SCORE-07] rejects cross-House ledger writes and standings reads', async () => {
    const award = publishedPuzzleScore(id(2_701), world.first.member.membershipId);
    await expect(
      repository.append({
        houseId: world.second.houseId,
        seasonId,
        entries: [{ ...award, id: id(2_702) }],
        createdAt: startedAt,
        recordedAt: startedAt,
        resultEventId: id(2_703),
        sourceEventId: id(2_704),
        sourceTopic: 'puzzle.published',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      repository.readStandings(
        fakeAuthorizationContext({
          houseId: world.second.houseId,
          viewerId: world.second.member.userId,
        }),
        seasonId,
      ),
    ).resolves.toBeNull();
  });
});
