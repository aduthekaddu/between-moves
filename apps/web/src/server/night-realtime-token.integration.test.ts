import { HmacRealtimeTokenIssuer, inspectRealtimeCapabilityToken } from '@between-moves/adapters';
import { createAuthorizeHouseAction, mintRealtimeToken } from '@between-moves/application';
import { realtimeTokenHidesRootKey, realtimeTokenResponseSchema } from '@between-moves/contracts';
import {
  migrateDown,
  migrateUp,
  PgHouseAuthorizationMembershipRepository,
  PgNightRealtimeScopeRepository,
  PgSeasonRepository,
} from '@between-moves/db';
import { twoHousesWithMembers, type TwoHousesWithMembers } from '@between-moves/db/testing';
import type { AuthenticatedViewer } from '@between-moves/domain';
import { fakeAuthorizationContext, FakeClock } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const serverKey = 'realtime-integration-server-key';
const publicKey = 'realtime-integration-public-key';
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

function viewer(user: {
  readonly userId: string;
  readonly displayName: string;
}): AuthenticatedViewer {
  return {
    kind: 'authenticated',
    userId: user.userId,
    displayName: user.displayName,
    imageUrl: null,
  };
}

describe('BM-037 realtime token scoping', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const tokens = new HmacRealtimeTokenIssuer({
    appId: 'realtime-integration-app',
    serverKey,
    publicKey,
  });
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    const owner = fakeAuthorizationContext({
      viewerId: world.first.member.userId,
      houseId: world.first.houseId,
    });
    const seasons = new PgSeasonRepository(database);
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
               '{"kind":"live","initialMs":600000,"incrementMs":0}', 600000, 600000, $7),
              ($8, $2, $3, $9, 'live', 'active', $5, $6,
               '{"kind":"live","initialMs":600000,"incrementMs":0}', 600000, 600000, $7)`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        nightIds[0],
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        createdAt,
        otherGameId,
        nightIds[1],
      ],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  function dependencies() {
    return {
      authorizeHouseAction: createAuthorizeHouseAction({
        memberships: new PgHouseAuthorizationMembershipRepository(database),
        nightHosts: { isAssignedNightHost: async () => false },
        denials: { record: () => undefined },
      }),
      clock: new FakeClock(createdAt),
      nights: new PgNightRealtimeScopeRepository(database),
      tokens,
    };
  }

  it('[BM-037] mints a token scoped to that Night and hides the root key', async () => {
    const issued = await mintRealtimeToken(
      {
        houseId: world.first.houseId,
        nightId: nightIds[0],
        viewer: viewer(world.first.nonOwner),
      },
      dependencies(),
    );
    const payload = inspectRealtimeCapabilityToken(issued.token, serverKey, createdAt);
    const body = realtimeTokenResponseSchema.parse({
      ...issued,
      expiresAt: issued.expiresAt.toISOString(),
    });

    expect(issued.channels.games.map((game) => game.gameId)).toEqual([gameId]);
    expect(payload.capability[issued.channels.night]).toEqual(['presence', 'subscribe']);
    expect(Object.keys(payload.capability)).toHaveLength(2);
    expect(realtimeTokenHidesRootKey(body, serverKey)).toBe(true);
    expect(JSON.stringify({ issued, payload, body })).not.toContain(serverKey);
  });

  it('[BM-037] [DR-SEC-01] denies another House member and another Night', async () => {
    const deps = dependencies();

    await expect(
      mintRealtimeToken(
        {
          houseId: world.first.houseId,
          nightId: nightIds[0],
          viewer: viewer(world.second.member),
        },
        deps,
      ),
    ).rejects.toMatchObject({ reason: 'not_a_member', crossHouse: true });
    await expect(
      mintRealtimeToken(
        {
          houseId: world.second.houseId,
          nightId: nightIds[0],
          viewer: viewer(world.second.member),
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });

    const first = await mintRealtimeToken(
      {
        houseId: world.first.houseId,
        nightId: nightIds[0],
        viewer: viewer(world.first.member),
      },
      deps,
    );
    const second = await mintRealtimeToken(
      {
        houseId: world.first.houseId,
        nightId: nightIds[1],
        viewer: viewer(world.first.member),
      },
      deps,
    );
    const firstPayload = inspectRealtimeCapabilityToken(first.token, serverKey, createdAt);
    const secondPayload = inspectRealtimeCapabilityToken(second.token, serverKey, createdAt);

    expect(second.channels.games.map((game) => game.gameId)).toEqual([otherGameId]);
    expect(firstPayload.capability[second.channels.night]).toBeUndefined();
    expect(secondPayload.capability[first.channels.night]).toBeUndefined();
  });
});
