import { createSeasonScoringConsumer } from '@between-moves/application';
import {
  migrateDown,
  migrateUp,
  PgHousePuzzleRepository,
  PgSeasonScoringRepository,
} from '@between-moves/db';
import { twoHousesWithMembers } from '@between-moves/db/testing';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const id = (number: number) => `01941f29-7c00-7000-8000-${String(number).padStart(12, '0')}`;
const now = new Date();
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('BM-046 confirm, publish, and score', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const puzzles = new PgHousePuzzleRepository(database);
  let houseId: string;
  let otherHouseId: string;
  let userId: string;
  let memberId: string;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    const world = await twoHousesWithMembers(database);
    houseId = world.first.houseId;
    otherHouseId = world.second.houseId;
    userId = world.first.member.userId;
    memberId = world.first.member.membershipId;
    await database.query(
      `insert into seasons (id,house_id,title,state,created_at,updated_at)
      values ($1,$2,'Puzzle season','draft',$3,$3)`,
      [id(4601), houseId, now],
    );
    await database.query(
      `insert into season_charters
      (id,season_id,version,correspondence_pace_hours,night_recurrence,points_recipe,published_at,created_at)
      values ($1,$2,1,24,'{"weekday":2,"localTime":"19:30","count":4}',
      '{"completedGame":1,"win":2,"draw":1,"nightAttendance":1,"publishedPuzzle":1,"caps":{"games":8,"nights":4,"puzzles":2}}',$3,$3)`,
      [id(4602), id(4601), now],
    );
    await database.query(
      `update seasons set state='active',starts_at=$2,ends_at=$3,published_charter_version=1 where id=$1`,
      [id(4601), new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 86_400_000)],
    );
    await database.query(
      `insert into games (id,house_id,season_id,mode,state,white_membership_id,
      black_membership_id,clock_policy,current_ply,created_at,completed_at)
      values ($1,$2,$3,'correspondence','completed',$4,$5,$6,3,$7,$7)`,
      [
        id(4603),
        houseId,
        id(4601),
        memberId,
        world.first.nonOwner.membershipId,
        { kind: 'correspondence', perMoveHours: 24 },
        now,
      ],
    );
    await database.query(
      `insert into analysis_jobs
      (id,source_event_id,game_id,house_id,engine_version,state,result,created_at,completed_at)
      values ($1,$2,$3,$4,'v1','completed','{"swings":[]}',$5,$5)`,
      [id(4604), id(4605), id(4603), houseId, now],
    );
    for (let index = 1; index <= 3; index += 1) {
      await database.query(
        `insert into puzzle_candidates
        (id,analysis_job_id,game_id,house_id,season_id,source_ply,position_fen,
        best_line,evaluation_swing_cp,created_at)
        values ($1,$2,$3,$4,$5,$6,$7,'["e2e4"]',300,$8)`,
        [id(4610 + index), id(4604), id(4603), houseId, id(4601), index, fen, now],
      );
    }
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('commits each confirmed puzzle and scores only the first two', async () => {
    const context = fakeAuthorizationContext({ houseId, viewerId: userId });
    const consumer = createSeasonScoringConsumer({
      scoring: new PgSeasonScoringRepository(database),
      ids: {
        generate: (() => {
          let next = 4700;
          return () => id(next++);
        })(),
      },
      clock: { now: () => now },
      events: { record: () => undefined },
    });
    expect((await puzzles.read(context)).candidates).toHaveLength(3);
    for (let index = 1; index <= 3; index += 1) {
      const puzzle = await puzzles.publish(context, {
        candidateId: id(4610 + index),
        puzzleId: id(4620 + index),
        eventId: id(4630 + index),
        prompt: `What is the move ${index}?`,
        now,
      });
      expect(puzzle.contributorName).toBe('Ada');
      const outbox = await database.query<{
        id: string;
        aggregate_id: string;
        payload: Record<string, unknown>;
      }>(`select id::text,aggregate_id::text,payload from outbox_events where id=$1`, [
        id(4630 + index),
      ]);
      const event = outbox.rows[0]!;
      await consumer.consume({
        id: event.id,
        topic: 'puzzle.published',
        aggregateId: event.aggregate_id,
        sequence: 1n,
        houseId,
        payload: event.payload,
        availableAt: now,
        occurredAt: now,
        attempts: 1,
      });
    }
    const board = await puzzles.read(context);
    expect(board.candidates).toHaveLength(0);
    expect(board.published).toHaveLength(3);
    const points = await database.query<{ count: number }>(
      `select count(*)::int as count from season_score_ledger where house_id=$1 and membership_id=$2 and source_kind='puzzle_published'`,
      [houseId, memberId],
    );
    expect(points.rows[0]?.count).toBe(2);
    await expect(
      puzzles.publish(context, {
        candidateId: id(4611),
        puzzleId: id(4690),
        eventId: id(4691),
        prompt: 'Again?',
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('denies cross-House reads and publication', async () => {
    const outsider = fakeAuthorizationContext({ houseId: otherHouseId, viewerId: userId });
    expect(await puzzles.read(outsider)).toEqual({ candidates: [], published: [] });
    await expect(
      puzzles.publish(outsider, {
        candidateId: id(4611),
        puzzleId: id(4690),
        eventId: id(4691),
        prompt: 'Foreign?',
        now,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      (await puzzles.read(fakeAuthorizationContext({ houseId, viewerId: userId }))).candidates,
    ).toHaveLength(3);
  });
});
