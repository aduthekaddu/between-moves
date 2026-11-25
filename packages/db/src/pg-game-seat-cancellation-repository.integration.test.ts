import type { GameSeatCreationInput } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgGameSeatAcceptanceRepository } from './pg-game-seat-acceptance-repository';
import { PgGameSeatCancellationRepository } from './pg-game-seat-cancellation-repository';
import { PgGameSeatRepository } from './pg-game-seat-repository';
import { PgOpenSeatReadRepository } from './pg-open-seat-read-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const now = new Date('2026-09-02T08:00:00.000Z');
const seasonId = id(1_401);

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

async function createActiveSeason(database: Pool, houseId: string): Promise<void> {
  await database.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
    [seasonId, houseId, now],
  );
  await database.query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
       published_at, created_at)
     values ($1, $2, 1, 48, '{"weekday":5,"localTime":"19:30","count":4}', '{}', $3, $3)`,
    [id(1_402), seasonId, now],
  );
  await database.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3,
            published_charter_version = 1, updated_at = $2
      where id = $1`,
    [seasonId, now, new Date('2026-09-30T08:00:00.000Z')],
  );
}

function seat(suffix: number, intendedMembershipId: string | null = null): GameSeatCreationInput {
  return {
    gameId: id(suffix),
    openSeatId: id(suffix + 1),
    mode: 'correspondence',
    clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
    offeredColor: 'white',
    creatorColor: 'black',
    intendedMembershipId,
    idempotencyKey: null,
    idempotencyPayload: '{}',
    createdAt: now,
    expiresAt: new Date('2026-09-09T08:00:00.000Z'),
  };
}

describe('PostgreSQL Open seat cancellation', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 4 });
  const seats = new PgGameSeatRepository(database);
  const cancellations = new PgGameSeatCancellationRepository(database);
  const acceptances = new PgGameSeatAcceptanceRepository(database);
  const listings = new PgOpenSeatReadRepository(database);
  let world: TwoHousesWithMembers;

  function as(who: 'ada' | 'bea' | 'mira', house = world.first) {
    const viewerId =
      who === 'ada'
        ? world.first.member.userId
        : who === 'bea'
          ? world.first.nonOwner.userId
          : world.switchingMember.userId;
    return fakeAuthorizationContext({ houseId: house.houseId, viewerId });
  }

  async function states(gameId: string) {
    const result = await database.query(
      `select g.state as game, s.state as seat
         from games g join open_seats s on s.game_id = g.id where g.id = $1`,
      [gameId],
    );
    return result.rows[0];
  }

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

  it('[BM-022] lets the creator take down an open seat, once', async () => {
    await seats.create(as('ada'), seat(1_410));

    await expect(
      cancellations.cancel(as('ada'), { gameId: id(1_410), cancelledAt: now }),
    ).resolves.toEqual({
      gameId: id(1_410),
      houseId: world.first.houseId,
      cancelledBy: 'creator',
      state: 'cancelled',
      cancelledNow: true,
    });
    await expect(states(id(1_410))).resolves.toEqual({ game: 'cancelled', seat: 'cancelled' });
    await expect(
      cancellations.cancel(as('ada'), { gameId: id(1_410), cancelledAt: now }),
    ).resolves.toMatchObject({ cancelledNow: false });
    await expect(listings.listOpenSeats(as('bea'), now)).resolves.toEqual([]);
    await expect(
      acceptances.accept(as('bea'), { gameId: id(1_410), acceptedAt: now }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('[BM-023] lets the challenged Member decline, and nobody else', async () => {
    await seats.create(as('ada'), seat(1_420, world.first.nonOwner.membershipId));
    await seats.create(as('ada'), seat(1_430));

    await expect(
      cancellations.cancel(as('mira'), { gameId: id(1_420), cancelledAt: now }),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(
      cancellations.cancel(as('bea'), { gameId: id(1_430), cancelledAt: now }),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(
      cancellations.cancel(as('bea'), { gameId: id(1_420), cancelledAt: now }),
    ).resolves.toMatchObject({ cancelledBy: 'challenged', cancelledNow: true });
    await expect(states(id(1_420))).resolves.toEqual({ game: 'cancelled', seat: 'cancelled' });
    await expect(states(id(1_430))).resolves.toEqual({ game: 'waiting', seat: 'open' });
  });

  it('[BM-022] [DR-SEC-01] keeps taken and other-House seats', async () => {
    await seats.create(as('ada'), seat(1_440));
    await acceptances.accept(as('bea'), { gameId: id(1_440), acceptedAt: now });

    await expect(
      cancellations.cancel(as('ada'), { gameId: id(1_440), cancelledAt: now }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(states(id(1_440))).resolves.toEqual({ game: 'active', seat: 'accepted' });

    await seats.create(as('ada'), seat(1_450));
    const otherHouse = fakeAuthorizationContext({
      houseId: world.second.houseId,
      viewerId: world.second.member.userId,
    });
    await expect(
      cancellations.cancel(otherHouse, { gameId: id(1_450), cancelledAt: now }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(states(id(1_450))).resolves.toEqual({ game: 'waiting', seat: 'open' });
  });
});
