import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { expect, test } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const seasonId = '01941f29-7c00-7000-8000-000000000801';
const charterId = '01941f29-7c00-7000-8000-000000000802';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('Game acceptance E2E fixture is not ready');
  return world;
}

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

test.describe('Open-seat acceptance', () => {
  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl);
    await resetTwoHousesWithMembers(database.pool);
    world = await twoHousesWithMembers(database.pool);
    const seeded = fixture();
    const now = new Date('2026-09-02T08:00:00.000Z');
    await database.pool.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, '2099-01-01T00:00:00.000Z'),
              ($4, $5, $6, '2099-01-01T00:00:00.000Z')`,
      [
        seeded.first.member.sessionId,
        seeded.first.member.userId,
        seeded.first.member.sessionToken,
        seeded.first.nonOwner.sessionId,
        seeded.first.nonOwner.userId,
        seeded.first.nonOwner.sessionToken,
      ],
    );
    await database.pool.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
      [seasonId, seeded.first.houseId, now],
    );
    await database.pool.query(
      `insert into season_charters
        (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
         published_at, created_at)
       values ($1, $2, 1, 48, '{"weekday":5,"localTime":"19:30","count":4}', '{}', $3, $3)`,
      [charterId, seasonId, now],
    );
    await database.pool.query(
      `update seasons
          set state = 'active', starts_at = $2, ends_at = $3,
              published_charter_version = 1, updated_at = $2
        where id = $1`,
      [seasonId, now, new Date('2026-09-30T08:00:00.000Z')],
    );
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-023] two Members create and accept an Open seat to reach an active Game', async ({
    request,
  }) => {
    const seeded = fixture();
    const origin = 'http://127.0.0.1:3100';
    const creatorCookie = await signedCookie(seeded.first.member.sessionToken);
    const acceptorCookie = await signedCookie(seeded.first.nonOwner.sessionToken);

    const created = await request.post(`/api/houses/${seeded.first.houseId}/games`, {
      headers: {
        cookie: creatorCookie,
        origin,
        'idempotency-key': 'bm-023-e2e-create',
        'x-request-id': 'bm-023-e2e-create',
      },
      data: {
        mode: 'correspondence',
        clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
        offeredColor: 'black',
      },
    });
    expect(created.status()).toBe(201);
    const creation: unknown = await created.json();
    expect(creation).toMatchObject({ gameId: expect.any(String), openSeatId: expect.any(String) });
    if (
      creation === null ||
      typeof creation !== 'object' ||
      !('gameId' in creation) ||
      typeof creation.gameId !== 'string'
    ) {
      throw new Error('Game creation response is invalid');
    }

    const accepted = await request.post(
      `/api/houses/${seeded.first.houseId}/games/${creation.gameId}/accept`,
      {
        headers: {
          cookie: acceptorCookie,
          origin,
          'x-request-id': 'bm-023-e2e-accept',
        },
      },
    );

    expect(accepted.status()).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ gameId: creation.gameId, state: 'active' });
    const persisted = await database?.pool.query(
      `select state, white_membership_id::text, black_membership_id::text
         from games where id = $1 and house_id = $2`,
      [creation.gameId, seeded.first.houseId],
    );
    expect(persisted?.rows).toEqual([
      {
        state: 'active',
        white_membership_id: seeded.first.member.membershipId,
        black_membership_id: seeded.first.nonOwner.membershipId,
      },
    ]);
  });
});
