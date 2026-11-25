import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgNightRealtimeScopeRepository } from './pg-night-realtime-scope-repository';
import { PgSeasonRepository } from './pg-season-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const seasonId = '01941f29-7c00-7000-8000-000000000801';
const charterId = '01941f29-7c00-7000-8000-000000000811';
const nightIds = [
  '01941f29-7c00-7000-8000-000000000901',
  '01941f29-7c00-7000-8000-000000000902',
  '01941f29-7c00-7000-8000-000000000903',
  '01941f29-7c00-7000-8000-000000000904',
] as const;
const gameId = '01941f29-7c00-7000-8000-000000000851';
const otherGameId = '01941f29-7c00-7000-8000-000000000852';
const createdAt = new Date('2026-09-01T12:00:00.000Z');

describe('PostgreSQL Night realtime scope', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const scopes = new PgNightRealtimeScopeRepository(database);
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
      title: 'Realtime season',
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
      title: 'Realtime season',
      startsAt: new Date('2026-09-04T00:00:00.000Z'),
      endsAt: new Date('2026-10-02T00:00:00.000Z'),
      publishedAt: createdAt,
      nightIds,
    });
    await database.query(
      `insert into games
        (id, house_id, season_id, night_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, white_clock_ms, black_clock_ms, created_at)
       values ($1, $2, $3, $4, 'live', 'active', $5, $6,
               '{"kind":"live","initialMs":600000,"incrementMs":0}', 600000, 600000, $7)`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        nightIds[0],
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        createdAt,
      ],
    );
    await database.query(
      `insert into games
        (id, house_id, season_id, night_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, white_clock_ms, black_clock_ms, created_at)
       values ($1, $2, $3, $4, 'live', 'active', $5, $6,
               '{"kind":"live","initialMs":600000,"incrementMs":0}', 600000, 600000, $7)`,
      [
        otherGameId,
        world.first.houseId,
        seasonId,
        nightIds[1],
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        createdAt,
      ],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-037] reads one Night and only its Game channels', async () => {
    const scope = await scopes.read(
      fakeAuthorizationContext({
        viewerId: world.first.nonOwner.userId,
        houseId: world.first.houseId,
      }),
      nightIds[0],
    );

    expect(scope).toEqual({
      houseId: world.first.houseId,
      nightId: nightIds[0],
      gameIds: [gameId],
    });
  });

  it('[BM-037] [DR-SEC-01] denies cross-House and cross-Night reads', async () => {
    const otherHouse = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.second.houseId,
    });
    const sameHouse = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });

    await expect(scopes.read(otherHouse, nightIds[0])).resolves.toBeNull();
    await expect(
      scopes.read(
        fakeAuthorizationContext({
          viewerId: world.second.member.userId,
          houseId: world.first.houseId,
        }),
        nightIds[0],
      ),
    ).resolves.toBeNull();
    const otherNight = await scopes.read(sameHouse, nightIds[1]);
    expect(otherNight?.gameIds).toEqual([otherGameId]);
    expect(otherNight?.gameIds).not.toContain(gameId);
  });

  it('[BM-037] does not expose a cancelled Night', async () => {
    await database.query(
      `update house_nights set state = 'cancelled', updated_at = $2 where id = $1`,
      [nightIds[0], createdAt],
    );
    await expect(
      scopes.read(
        fakeAuthorizationContext({
          viewerId: world.first.member.userId,
          houseId: world.first.houseId,
        }),
        nightIds[0],
      ),
    ).resolves.toBeNull();
  });
});
