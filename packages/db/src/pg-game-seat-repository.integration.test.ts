import { DomainError, type GameSeatCreationInput } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
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
const now = new Date('2026-09-02T08:00:00.000Z');

function context(world: TwoHousesWithMembers) {
  return fakeAuthorizationContext({
    viewerId: world.first.nonOwner.userId,
    houseId: world.first.houseId,
  });
}

function ownerContext(world: TwoHousesWithMembers) {
  return fakeAuthorizationContext({
    viewerId: world.first.member.userId,
    houseId: world.first.houseId,
  });
}

function input(
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
    idempotencyKey: 'bm-022-create-1',
    idempotencyPayload:
      '{"mode":"correspondence","clockPolicy":{"kind":"correspondence","perMoveHours":48},"offeredColor":"white","intendedMembershipId":null}',
    createdAt: now,
    expiresAt: new Date('2026-09-09T08:00:00.000Z'),
    ...overrides,
  };
}

async function createActiveSeason(database: Pool, houseId: string): Promise<void> {
  const client = await database.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
      [seasonId, houseId, now],
    );
    await client.query(
      `insert into season_charters
        (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
         published_at, created_at)
       values ($1, $2, 1, 48, '{"weekday":5,"localTime":"19:30","count":4}', '{}', $3, $3)`,
      [charterId, seasonId, now],
    );
    await client.query(
      `update seasons
          set state = 'active', starts_at = $2, ends_at = $3,
              published_charter_version = 1, updated_at = $2
        where id = $1`,
      [seasonId, now, new Date('2026-09-30T08:00:00.000Z')],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

describe('PostgreSQL Game seat repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 4 });
  const repository = new PgGameSeatRepository(database);
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

  it('[BM-022] [DR-SEAT-01..02] atomically creates a waiting Game and Open seat', async () => {
    await expect(repository.create(context(world), input())).resolves.toEqual({
      gameId,
      openSeatId,
      houseId: world.first.houseId,
      seasonId,
      creatorMembershipId: world.first.nonOwner.membershipId,
      intendedMembershipId: null,
      offeredColor: 'white',
      creatorColor: 'black',
      expiresAt: new Date('2026-09-09T08:00:00.000Z'),
      state: 'waiting',
      createdNow: true,
    });

    const persisted = await database.query(
      `select g.state, g.mode, g.white_membership_id::text, g.black_membership_id::text,
              g.clock_policy, s.offered_color, s.creator_membership_id::text,
              s.intended_membership_id::text, s.state as seat_state, s.expires_at
         from games g join open_seats s on s.game_id = g.id
        where g.id = $1 and g.house_id = $2`,
      [gameId, world.first.houseId],
    );
    expect(persisted.rows).toEqual([
      {
        state: 'waiting',
        mode: 'correspondence',
        white_membership_id: null,
        black_membership_id: world.first.nonOwner.membershipId,
        clock_policy: { kind: 'correspondence', perMoveHours: 48 },
        offered_color: 'white',
        creator_membership_id: world.first.nonOwner.membershipId,
        intended_membership_id: null,
        seat_state: 'open',
        expires_at: new Date('2026-09-09T08:00:00.000Z'),
      },
    ]);
  });

  it('[BM-022] records a direct challenge only for an active Member of the same House', async () => {
    const direct = input({
      intendedMembershipId: world.first.member.membershipId,
      idempotencyKey: null,
    });
    await expect(repository.create(context(world), direct)).resolves.toMatchObject({
      intendedMembershipId: world.first.member.membershipId,
    });

    await database.query('delete from games where id = $1', [gameId]);
    await expect(
      repository.create(
        context(world),
        input({
          gameId: '01941f29-7c00-7000-8000-000000000705',
          openSeatId: '01941f29-7c00-7000-8000-000000000706',
          intendedMembershipId: world.second.member.membershipId,
          idempotencyKey: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('[BM-022] rechecks membership, Charter pace, and self-challenge invariants', async () => {
    await expect(
      repository.create(
        context(world),
        input({ clockPolicy: { kind: 'correspondence', perMoveHours: 24 } }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      repository.create(
        context(world),
        input({ intendedMembershipId: world.first.nonOwner.membershipId, idempotencyKey: null }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    await database.query(
      "update memberships set status = 'removed', left_at = $2, updated_at = $2 where id = $1",
      [world.first.nonOwner.membershipId, now],
    );
    await expect(
      repository.create(context(world), input({ idempotencyKey: null })),
    ).rejects.toEqual(
      expect.objectContaining({ code: 'not_found' } satisfies Partial<DomainError>),
    );
  });

  it('[BM-022] replays one idempotency key and rejects payload reuse', async () => {
    await repository.create(context(world), input());
    await expect(
      repository.create(
        context(world),
        input({
          gameId: '01941f29-7c00-7000-8000-000000000705',
          openSeatId: '01941f29-7c00-7000-8000-000000000706',
        }),
      ),
    ).resolves.toMatchObject({ gameId, openSeatId, createdNow: false });
    await expect(
      repository.create(
        context(world),
        input({
          gameId: '01941f29-7c00-7000-8000-000000000705',
          openSeatId: '01941f29-7c00-7000-8000-000000000706',
          offeredColor: 'black',
          creatorColor: 'white',
          idempotencyPayload: 'different-payload',
        }),
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('[BM-022] creates reciprocal direct challenges without a membership-lock deadlock', async () => {
    const ownerGameId = '01941f29-7c00-7000-8000-000000000711';
    const ownerSeatId = '01941f29-7c00-7000-8000-000000000712';

    await expect(
      Promise.all([
        repository.create(
          context(world),
          input({ intendedMembershipId: world.first.member.membershipId, idempotencyKey: null }),
        ),
        repository.create(
          ownerContext(world),
          input({
            gameId: ownerGameId,
            openSeatId: ownerSeatId,
            intendedMembershipId: world.first.nonOwner.membershipId,
            idempotencyKey: null,
          }),
        ),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ gameId, openSeatId }),
      expect.objectContaining({ gameId: ownerGameId, openSeatId: ownerSeatId }),
    ]);
  });

  it('[BM-041] creates a live Game only within an active Night with at least three minutes', async () => {
    await database.query(
      `insert into house_nights (id, house_id, season_id, scheduled_start, scheduled_end,
        state, started_at) values ($1,$2,$3,$4,$5,'live',$4)`,
      [nightId, world.first.houseId, seasonId, now, new Date('2026-09-02T11:00:00.000Z')],
    );
    const live: GameSeatCreationInput = {
      ...input(),
      mode: 'live',
      nightId,
      clockPolicy: { kind: 'live', initialMs: 180_000, incrementMs: 2_000 },
    };
    await expect(repository.create(context(world), live)).resolves.toMatchObject({ gameId });
    await expect(
      database.query(
        `select night_id::text, mode, clock_policy, white_clock_ms, black_clock_ms
        from games where id=$1`,
        [gameId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          night_id: nightId,
          mode: 'live',
          clock_policy: live.clockPolicy,
          white_clock_ms: 180_000,
          black_clock_ms: 180_000,
        },
      ],
    });
    await expect(
      repository.create(context(world), {
        ...live,
        gameId: '01941f29-7c00-7000-8000-000000000715',
        openSeatId: '01941f29-7c00-7000-8000-000000000716',
        idempotencyKey: null,
        clockPolicy: { kind: 'live', initialMs: 179_999, incrementMs: 2_000 },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await database.query("update house_nights set state='ended', ended_at=$2 where id=$1", [
      nightId,
      new Date('2026-09-02T12:00:00.000Z'),
    ]);
    await expect(
      repository.create(context(world), {
        ...live,
        gameId: '01941f29-7c00-7000-8000-000000000717',
        openSeatId: '01941f29-7c00-7000-8000-000000000718',
        idempotencyKey: null,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
