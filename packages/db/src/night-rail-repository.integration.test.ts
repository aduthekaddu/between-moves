import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgNightRailRepository } from './pg-night-rail-repository';
import { PgSeasonRepository } from './pg-season-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const seasonId = '01941f29-7c00-7000-8000-000000000801';
const charterId = '01941f29-7c00-7000-8000-000000000811';
const nightIds = [
  '01941f29-7c00-7000-8000-000000000901',
  '01941f29-7c00-7000-8000-000000000902',
  '01941f29-7c00-7000-8000-000000000903',
  '01941f29-7c00-7000-8000-000000000904',
] as const;
const activeGameId = '01941f29-7c00-7000-8000-000000000851';
const completedGameId = '01941f29-7c00-7000-8000-000000000852';
const otherNightGameId = '01941f29-7c00-7000-8000-000000000853';
const createdAt = new Date('2026-09-01T12:00:00.000Z');
const startedAt = new Date('2026-09-04T14:00:00.000Z');

integration('PostgreSQL Night rail snapshot', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const rails = new PgNightRailRepository(database);
  const seasons = new PgSeasonRepository(database);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    const owner = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });
    await seasons.draft(owner, {
      seasonId,
      title: 'Rail season',
      idempotencyKey: null,
      createdAt,
    });
    await seasons.draftCharter(owner, {
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
      createdAt,
    });
    await seasons.publish(owner, {
      seasonId,
      title: 'Rail season',
      startsAt: new Date('2026-09-04T00:00:00.000Z'),
      endsAt: new Date('2026-10-02T00:00:00.000Z'),
      publishedAt: createdAt,
      nightIds,
    });
    await database.query(
      `update house_nights
          set state = 'live', started_at = $2, updated_at = $2
        where id = $1`,
      [nightIds[0], startedAt],
    );
    await database.query(
      `insert into games
        (id, house_id, season_id, night_id, mode, state, white_membership_id, black_membership_id,
         current_fen, current_ply, side_to_move, version, outbox_sequence, clock_policy,
         white_clock_ms, black_clock_ms, created_at)
       values ($1, $2, $3, $4, 'live', 'active', $5, $6,
               'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', 1, 'black', 1, 1,
               '{"kind":"live","initialMs":600000,"incrementMs":0}', 600000, 600000, $7)`,
      [
        activeGameId,
        world.first.houseId,
        seasonId,
        nightIds[0],
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        createdAt,
      ],
    );
    await database.query(
      `insert into moves
        (id, game_id, house_id, ply, actor_membership_id, uci, san, fen_after,
         client_command_id, accepted_version, server_received_at)
       values ($1, $2, $3, 1, $4, 'e2e4', 'e4',
               'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
               $5, 1, $6)`,
      [
        '01941f29-7c00-7000-8000-000000000861',
        activeGameId,
        world.first.houseId,
        world.first.member.membershipId,
        '01941f29-7c00-7000-8000-000000000871',
        startedAt,
      ],
    );
    await database.query(
      `insert into games
        (id, house_id, season_id, night_id, mode, state, white_membership_id, black_membership_id,
         current_fen, current_ply, side_to_move, version, outbox_sequence, result, result_reason,
         clock_policy, white_clock_ms, black_clock_ms, created_at, completed_at)
       values ($1, $2, $3, $4, 'live', 'completed', $5, $6,
               '8/8/8/8/8/8/8/4K2k w - - 0 1', 12, 'white', 12, 14, 'black_win', 'resign',
               '{"kind":"live","initialMs":600000,"incrementMs":0}', 120000, 180000, $7, $8)`,
      [
        completedGameId,
        world.first.houseId,
        seasonId,
        nightIds[0],
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        createdAt,
        startedAt,
      ],
    );
    await database.query(
      `insert into games
        (id, house_id, season_id, night_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, white_clock_ms, black_clock_ms, created_at)
       values ($1, $2, $3, $4, 'live', 'active', $5, $6,
               '{"kind":"live","initialMs":600000,"incrementMs":0}', 600000, 600000, $7)`,
      [
        otherNightGameId,
        world.first.houseId,
        seasonId,
        nightIds[1],
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        createdAt,
      ],
    );
    await database.query(
      `insert into night_attendance
        (id, house_id, night_id, membership_id, first_joined_at, current_joined_at,
         accumulated_seconds, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $5, 0, $5, $5)`,
      [
        '01941f29-7c00-7000-8000-000000000881',
        world.first.houseId,
        nightIds[0],
        world.first.member.membershipId,
        startedAt,
      ],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-038] reads durable boards and results without deriving presence from attendance', async () => {
    const rail = await rails.read(
      fakeAuthorizationContext({
        viewerId: world.first.nonOwner.userId,
        houseId: world.first.houseId,
      }),
      nightIds[0],
    );

    expect(rail).toMatchObject({
      houseId: world.first.houseId,
      nightId: nightIds[0],
      state: 'live',
      nightSequence: 1n,
      presence: [],
      presenceCount: 0,
    });
    expect(rail?.activeBoards).toEqual([
      expect.objectContaining({
        gameId: activeGameId,
        sequence: 1n,
        lastSan: 'e4',
        sideToMove: 'black',
        white: expect.objectContaining({ name: 'Ada' }),
        black: expect.objectContaining({ name: 'Bea' }),
      }),
    ]);
    expect(rail?.recentResults).toEqual([
      expect.objectContaining({
        gameId: completedGameId,
        result: 'black_win',
        sequence: 14n,
      }),
    ]);
    expect(rail?.activeBoards.map((board) => board.gameId)).not.toContain(otherNightGameId);
  });

  it('[BM-038] [DR-SEC-01] denies cross-House and cancelled Night reads', async () => {
    const otherHouse = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.second.houseId,
    });
    await expect(rails.read(otherHouse, nightIds[0])).resolves.toBeNull();
    await expect(
      rails.read(
        fakeAuthorizationContext({
          viewerId: world.second.member.userId,
          houseId: world.first.houseId,
        }),
        nightIds[0],
      ),
    ).resolves.toBeNull();

    await database.query(
      `update house_nights
          set state = 'cancelled', started_at = null, ended_at = null, updated_at = $2
        where id = $1`,
      [nightIds[0], createdAt],
    );
    await expect(
      rails.read(
        fakeAuthorizationContext({
          viewerId: world.first.member.userId,
          houseId: world.first.houseId,
        }),
        nightIds[0],
      ),
    ).resolves.toBeNull();
  });
});
