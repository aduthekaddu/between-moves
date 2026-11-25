import type { GameSeatCreationInput } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgGameSeatAcceptanceRepository } from './pg-game-seat-acceptance-repository';
import { PgGameSeatRepository } from './pg-game-seat-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const seasonId = '01941f29-7c00-7000-8000-000000000701';
const charterId = '01941f29-7c00-7000-8000-000000000702';
const gameId = '01941f29-7c00-7000-8000-000000000703';
const openSeatId = '01941f29-7c00-7000-8000-000000000704';
const nightId = '01941f29-7c00-7000-8000-000000000705';
const createdAt = new Date('2026-09-02T08:00:00.000Z');
const acceptedAt = new Date('2026-09-02T09:00:00.000Z');

function context(world: TwoHousesWithMembers, actor: 'creator' | 'owner' | 'switching') {
  const viewerId =
    actor === 'creator'
      ? world.first.nonOwner.userId
      : actor === 'owner'
        ? world.first.member.userId
        : world.switchingMember.userId;
  return fakeAuthorizationContext({ viewerId, houseId: world.first.houseId });
}

function creationInput(
  overrides: Partial<Extract<GameSeatCreationInput, { mode: 'correspondence' }>> = {},
): GameSeatCreationInput {
  return {
    gameId,
    openSeatId,
    mode: 'correspondence',
    clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
    offeredColor: 'white',
    creatorColor: 'black',
    intendedMembershipId: null,
    idempotencyKey: null,
    idempotencyPayload: 'unused-without-an-idempotency-key',
    createdAt,
    expiresAt: new Date('2026-09-09T08:00:00.000Z'),
    ...overrides,
  };
}

async function createActiveSeason(database: Pool, houseId: string): Promise<void> {
  await database.query(
    `insert into seasons
      (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
    [seasonId, houseId, createdAt],
  );
  await database.query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
       published_at, created_at)
     values ($1, $2, 1, 48, '{"weekday":5,"localTime":"19:30","count":4}', '{}', $3, $3)`,
    [charterId, seasonId, createdAt],
  );
  await database.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3,
            published_charter_version = 1, updated_at = $2
      where id = $1`,
    [seasonId, createdAt, new Date('2026-09-30T08:00:00.000Z')],
  );
}

describe('PostgreSQL Game seat acceptance repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 6 });
  const creation = new PgGameSeatRepository(database);
  const acceptance = new PgGameSeatAcceptanceRepository(database);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await createActiveSeason(database, world.first.houseId);
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-023] [DR-SEAT-03] assigns the second seat and activates the Game atomically', async () => {
    await creation.create(context(world, 'creator'), creationInput());

    await expect(
      acceptance.accept(context(world, 'owner'), { gameId, acceptedAt }),
    ).resolves.toEqual({
      gameId,
      houseId: world.first.houseId,
      whiteMembershipId: world.first.member.membershipId,
      blackMembershipId: world.first.nonOwner.membershipId,
      moveDueAt: new Date('2026-09-04T09:00:00.000Z'),
      state: 'active',
    });

    const persisted = await database.query(
      `select g.state, g.white_membership_id::text, g.black_membership_id::text,
              g.move_due_at, s.state as seat_state
         from games g join open_seats s on s.game_id = g.id
        where g.id = $1`,
      [gameId],
    );
    expect(persisted.rows).toEqual([
      {
        state: 'active',
        white_membership_id: world.first.member.membershipId,
        black_membership_id: world.first.nonOwner.membershipId,
        move_due_at: new Date('2026-09-04T09:00:00.000Z'),
        seat_state: 'accepted',
      },
    ]);
  });

  it('[BM-023] allows only the intended Member to accept a direct challenge', async () => {
    await creation.create(
      context(world, 'creator'),
      creationInput({ intendedMembershipId: world.first.member.membershipId }),
    );

    await expect(
      acceptance.accept(context(world, 'creator'), { gameId, acceptedAt }),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(
      acceptance.accept(context(world, 'switching'), { gameId, acceptedAt }),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(
      acceptance.accept(context(world, 'owner'), { gameId, acceptedAt }),
    ).resolves.toMatchObject({ state: 'active' });
  });

  it('[BM-023] expires an elapsed Open seat without activating its Game', async () => {
    await creation.create(
      context(world, 'creator'),
      creationInput({ expiresAt: new Date('2026-09-03T08:00:00.000Z') }),
    );

    await expect(
      acceptance.accept(context(world, 'owner'), {
        gameId,
        acceptedAt: new Date('2026-09-03T08:00:00.001Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      database.query(
        `select g.state as game_state, s.state as seat_state
           from games g join open_seats s on s.game_id = g.id where g.id = $1`,
        [gameId],
      ),
    ).resolves.toMatchObject({ rows: [{ game_state: 'waiting', seat_state: 'expired' }] });
  });

  it('[BM-023] concurrent acceptances produce one activation and one seat-taken conflict', async () => {
    await creation.create(context(world, 'creator'), creationInput());

    const outcomes = await Promise.allSettled([
      acceptance.accept(context(world, 'owner'), { gameId, acceptedAt }),
      acceptance.accept(context(world, 'switching'), { gameId, acceptedAt }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'conflict' });

    const persisted = await database.query(
      `select g.state, s.state as seat_state,
              (g.white_membership_id is not null and g.black_membership_id is not null) as seated
         from games g join open_seats s on s.game_id = g.id where g.id = $1`,
      [gameId],
    );
    expect(persisted.rows).toEqual([{ state: 'active', seat_state: 'accepted', seated: true }]);
  });

  it('[BM-023] [DR-SEC-01] denies cross-House acceptance without changing the Game', async () => {
    await creation.create(context(world, 'creator'), creationInput());
    const otherHouseContext = fakeAuthorizationContext({
      viewerId: world.second.member.userId,
      houseId: world.second.houseId,
    });

    await expect(
      acceptance.accept(otherHouseContext, { gameId, acceptedAt }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      database.query(
        `select g.state as game_state, s.state as seat_state
           from games g join open_seats s on s.game_id = g.id where g.id = $1`,
        [gameId],
      ),
    ).resolves.toMatchObject({ rows: [{ game_state: 'waiting', seat_state: 'open' }] });
  });

  it('[BM-041] starts the white live clock when the second seat is accepted', async () => {
    await database.query(
      `insert into house_nights (id, house_id, season_id, scheduled_start, scheduled_end,
        state, started_at) values ($1,$2,$3,$4,$5,'live',$4)`,
      [nightId, world.first.houseId, seasonId, createdAt, new Date('2026-09-02T11:00:00.000Z')],
    );
    await creation.create(context(world, 'creator'), {
      ...creationInput(),
      mode: 'live',
      nightId,
      clockPolicy: { kind: 'live', initialMs: 300_000, incrementMs: 2_000 },
    });
    const activatedAt = new Date(acceptedAt.getTime() + 7_000);
    await expect(
      acceptance.accept(context(world, 'owner'), {
        gameId,
        acceptedAt,
        startLiveClockAt: () => activatedAt,
      }),
    ).resolves.toMatchObject({ moveDueAt: null, turnStartedAt: activatedAt });
    await expect(
      database.query(
        'select turn_started_at, white_clock_ms, black_clock_ms from games where id=$1',
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [{ turn_started_at: activatedAt, white_clock_ms: 300_000, black_clock_ms: 300_000 }],
    });
  });
});
