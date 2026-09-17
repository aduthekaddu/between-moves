import { fakeAuthorizationContext, FakeClock } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgNightAttendanceRepository } from './pg-night-attendance-repository';
import { PgSeasonRepository } from './pg-season-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

integration('PostgreSQL Between Moves Night attendance', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const seasonId = id(960);
  const charterId = id(961);
  const nightIds = [id(962), id(963), id(964), id(965)] as const;
  const startedAt = new Date('2026-09-04T14:00:00.000Z');
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    const seasons = new PgSeasonRepository(database);
    const ownerContext = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });
    await seasons.draft(ownerContext, {
      seasonId,
      title: 'Attendance season',
      idempotencyKey: null,
      createdAt: startedAt,
    });
    await seasons.draftCharter(ownerContext, {
      charterId,
      seasonId,
      correspondencePaceHours: 24,
      nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
      pointsRecipe: {
        completedGame: 1,
        win: 2,
        draw: 1,
        nightAttendance: 1,
        publishedPuzzle: 1,
        caps: { games: 8, nights: 4, puzzles: 2 },
      },
      createdAt: startedAt,
    });
    await seasons.publish(ownerContext, {
      seasonId,
      title: 'Attendance season',
      startsAt: new Date('2026-09-04T00:00:00.000Z'),
      endsAt: new Date('2026-10-02T00:00:00.000Z'),
      publishedAt: startedAt,
      nightIds,
    });
    await database.query(
      `update house_nights
          set state = 'live', started_at = $2, updated_at = $2
        where id = $1`,
      [nightIds[0], startedAt],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-033] [DR-NIGHT-02/05] emits one scoring event at 15 durable minutes', async () => {
    const clock = new FakeClock(startedAt);
    const attendance = new PgNightAttendanceRepository(database);
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.nonOwner.userId,
    });

    await attendance.join(context, {
      attendanceId: id(970),
      nightId: nightIds[0],
      joinedAt: clock.now(),
    });
    clock.advance(899_000);
    await expect(
      attendance.qualify({
        houseId: world.first.houseId,
        nightId: nightIds[0],
        membershipId: world.first.nonOwner.membershipId,
        scoringEventId: id(971),
        qualifiedAt: clock.now(),
        reason: 'duration',
      }),
    ).resolves.toMatchObject({ scoringEventEmitted: false });
    expect(
      await database.query('select count(*)::int as count from outbox_events where topic=$1', [
        'night.attendance-qualified',
      ]),
    ).toMatchObject({ rows: [{ count: 0 }] });

    clock.advance(1_000);
    await expect(
      attendance.qualify({
        houseId: world.first.houseId,
        nightId: nightIds[0],
        membershipId: world.first.nonOwner.membershipId,
        scoringEventId: id(972),
        qualifiedAt: clock.now(),
        reason: 'duration',
      }),
    ).resolves.toMatchObject({
      accumulatedSeconds: 900,
      currentJoinedAt: new Date('2026-09-04T14:15:00.000Z'),
      qualifiedAt: new Date('2026-09-04T14:15:00.000Z'),
      qualificationReason: 'duration',
      scoringEventEmitted: true,
    });
    await expect(
      attendance.leave(context, {
        nightId: nightIds[0],
        scoringEventId: id(973),
        leftAt: clock.now(),
      }),
    ).resolves.toMatchObject({
      accumulatedSeconds: 900,
      scoringEventEmitted: false,
    });

    const event = await database.query(
      `select topic, aggregate_id::text as aggregate_id, house_id::text as house_id,
              sequence::text as sequence, payload
         from outbox_events where topic = 'night.attendance-qualified'`,
    );
    expect(event.rows).toEqual([
      {
        topic: 'night.attendance-qualified',
        aggregate_id: id(970),
        house_id: world.first.houseId,
        sequence: '1',
        payload: {
          membershipId: world.first.nonOwner.membershipId,
          nightId: nightIds[0],
          points: 1,
          qualificationReason: 'duration',
          seasonId,
          sourceKey: `night:${nightIds[0]}`,
          sourceKind: 'night_attendance',
        },
      },
    ]);
  });

  it('[BM-033] [DR-SCORE-08] keeps repeated joins/leaves unique and scores once', async () => {
    const clock = new FakeClock(startedAt);
    const repository = new PgNightAttendanceRepository(database);
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.nonOwner.userId,
    });
    let nextId = 980;
    const join = () =>
      repository.join(context, {
        attendanceId: id(nextId++),
        nightId: nightIds[0],
        joinedAt: clock.now(),
      });
    const leave = () =>
      repository.leave(context, {
        nightId: nightIds[0],
        scoringEventId: id(nextId++),
        leftAt: clock.now(),
      });

    const first = await join();
    const repeated = await join();
    expect(repeated.attendanceId).toBe(first.attendanceId);
    clock.advance(600_000);
    await leave();
    await leave();
    await join();
    clock.advance(300_000);
    const thresholdLeaves = await Promise.all([leave(), leave()]);
    expect(thresholdLeaves.filter((result) => result?.scoringEventEmitted)).toHaveLength(1);
    await join();
    clock.advance(60_000);
    await leave();

    const attendance = await database.query(
      `select count(*)::int as count, max(accumulated_seconds)::int as accumulated_seconds
         from night_attendance where night_id=$1 and membership_id=$2`,
      [nightIds[0], world.first.nonOwner.membershipId],
    );
    const events = await database.query(
      "select count(*)::int as count from outbox_events where topic='night.attendance-qualified'",
    );
    expect(attendance.rows).toEqual([{ count: 1, accumulated_seconds: 960 }]);
    expect(events.rows).toEqual([{ count: 1 }]);
  });

  it('[BM-033] [DR-NIGHT-05] defines the completed-live-Game qualification seam', async () => {
    const repository = new PgNightAttendanceRepository(database);
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    await repository.join(context, {
      attendanceId: id(990),
      nightId: nightIds[0],
      joinedAt: startedAt,
    });

    await expect(
      repository.qualify({
        houseId: world.first.houseId,
        nightId: nightIds[0],
        membershipId: world.first.member.membershipId,
        scoringEventId: id(991),
        qualifiedAt: startedAt,
        reason: 'completed_live_game',
      }),
    ).resolves.toMatchObject({
      qualificationReason: 'completed_live_game',
      scoringEventEmitted: true,
      sourceKey: `night:${nightIds[0]}`,
    });
    await expect(
      repository.qualify({
        houseId: world.first.houseId,
        nightId: nightIds[0],
        membershipId: world.first.member.membershipId,
        scoringEventId: id(992),
        qualifiedAt: startedAt,
        reason: 'completed_live_game',
      }),
    ).resolves.toMatchObject({ scoringEventEmitted: false });
  });

  it('[BM-033] [DR-DELIV-01] rolls attendance back when its outbox append fails', async () => {
    const clock = new FakeClock(startedAt);
    const repository = new PgNightAttendanceRepository(database);
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.nonOwner.userId,
    });
    await repository.join(context, {
      attendanceId: id(993),
      nightId: nightIds[0],
      joinedAt: clock.now(),
    });
    clock.advance(900_000);
    await database.query(
      `insert into outbox_events
        (id, topic, aggregate_id, sequence, house_id, payload, available_at, created_at)
       values ($1, 'test.conflict', $2, 1, $3, '{}'::jsonb, $4, $4)`,
      [id(994), id(995), world.first.houseId, startedAt],
    );

    await expect(
      repository.qualify({
        houseId: world.first.houseId,
        nightId: nightIds[0],
        membershipId: world.first.nonOwner.membershipId,
        scoringEventId: id(994),
        qualifiedAt: clock.now(),
        reason: 'duration',
      }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      database.query(
        `select current_joined_at, accumulated_seconds, qualified_at
           from night_attendance where id=$1`,
        [id(993)],
      ),
    ).resolves.toMatchObject({
      rows: [{ current_joined_at: startedAt, accumulated_seconds: 0, qualified_at: null }],
    });
    await expect(
      repository.qualify({
        houseId: world.first.houseId,
        nightId: nightIds[0],
        membershipId: world.first.nonOwner.membershipId,
        scoringEventId: id(996),
        qualifiedAt: clock.now(),
        reason: 'duration',
      }),
    ).resolves.toMatchObject({ scoringEventEmitted: true });
  });

  it("[BM-033] [DR-SEC-01] denies another House's Member and Night pairing", async () => {
    const clock = new FakeClock(startedAt);
    const repository = new PgNightAttendanceRepository(database);
    const context = fakeAuthorizationContext({
      houseId: world.second.houseId,
      viewerId: world.second.member.userId,
    });

    await expect(
      repository.join(context, {
        attendanceId: id(997),
        nightId: nightIds[0],
        joinedAt: clock.now(),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      repository.qualify({
        houseId: world.second.houseId,
        nightId: nightIds[0],
        membershipId: world.first.nonOwner.membershipId,
        scoringEventId: id(998),
        qualifiedAt: clock.now(),
        reason: 'completed_live_game',
      }),
    ).resolves.toBeNull();
    await expect(
      database.query('select count(*)::int as count from night_attendance'),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });
});
