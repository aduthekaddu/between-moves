import {
  closeSeason,
  createAuthorizeHouseAction,
  draftSeason,
  draftSeasonCharter,
  publishSeason,
  readLastClosedSeason,
} from '@between-moves/application';
import {
  migrateDown,
  migrateUp,
  PgHouseAuthorizationMembershipRepository,
  PgSeasonRepository,
} from '@between-moves/db';
import { twoHousesWithMembers, type TwoHousesWithMembers } from '@between-moves/db/testing';
import type { AuthenticatedViewer, SeasonTransitionObservation } from '@between-moves/domain';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const startsAt = new Date('2026-09-04T00:00:00.000Z');
const endsAt = new Date('2026-10-02T00:00:00.000Z');

function viewer(member: { readonly userId: string; readonly displayName: string }) {
  return {
    kind: 'authenticated',
    userId: member.userId,
    displayName: member.displayName,
    imageUrl: null,
  } satisfies AuthenticatedViewer;
}

describe('BM-047 close Season through House authorization', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  let world: TwoHousesWithMembers;
  let transitions: SeasonTransitionObservation[];
  let dependencies: Parameters<typeof closeSeason>[1] & Parameters<typeof publishSeason>[1];
  let next = 5000;

  async function activeSeason(owner: AuthenticatedViewer, houseId: string, title: string) {
    const draft = await draftSeason(
      { houseId, title, idempotencyKey: `draft-${next}`, viewer: owner },
      dependencies,
    );
    await draftSeasonCharter(
      {
        houseId,
        seasonId: draft.seasonId,
        correspondencePaceHours: 24,
        nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
        viewer: owner,
      },
      dependencies,
    );
    await publishSeason(
      { houseId, seasonId: draft.seasonId, title, startsAt, endsAt, viewer: owner },
      dependencies,
    );
    return draft.seasonId;
  }

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    transitions = [];
    let now = Date.parse('2026-10-02T12:00:00.000Z');
    dependencies = {
      authorizeHouseAction: createAuthorizeHouseAction({
        memberships: new PgHouseAuthorizationMembershipRepository(database),
        nightHosts: { isAssignedNightHost: async () => false },
        denials: { record: () => undefined },
      }),
      clock: { now: () => new Date((now += 1_000)) },
      ids: { generate: () => `01941f29-7c00-7000-8000-${String(next++).padStart(12, '0')}` },
      seasons: new PgSeasonRepository(database),
      transitions: { record: (observation) => transitions.push(observation) },
    };
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-047] AC1: an Owner closes an active Season through closing to closed', async () => {
    const owner = viewer(world.first.member);
    const seasonId = await activeSeason(owner, world.first.houseId, 'Autumn tables');
    transitions = [];

    const closed = await closeSeason(
      { houseId: world.first.houseId, seasonId, viewer: owner },
      dependencies,
    );

    expect(closed).toMatchObject({ seasonId, state: 'closed', closedNow: true });
    expect(closed.standings.map((standing) => standing.points)).toEqual([0, 0, 0]);
    expect(transitions.map(({ event, from, to, outcome }) => [event, from, to, outcome])).toEqual([
      ['close_season', 'active', 'closing', 'success'],
      ['finalize_season', 'closing', 'closed', 'success'],
    ]);
    await expect(
      readLastClosedSeason(
        { houseId: world.first.houseId, viewer: viewer(world.first.nonOwner) },
        {
          authorizeHouseAction: dependencies.authorizeHouseAction,
          seasons: new PgSeasonRepository(database),
        },
      ),
    ).resolves.toMatchObject({ seasonId, title: 'Autumn tables' });
  });

  it('[BM-047] AC2: a Member is denied and the Season stays active', async () => {
    const seasonId = await activeSeason(
      viewer(world.first.member),
      world.first.houseId,
      'Autumn tables',
    );

    await expect(
      closeSeason(
        { houseId: world.first.houseId, seasonId, viewer: viewer(world.first.nonOwner) },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'authorization_denied', reason: 'role_not_permitted' });
    const state = await database.query('select state from seasons where id = $1', [seasonId]);
    expect(state.rows).toEqual([{ state: 'active' }]);
  });

  it('[BM-047] denies an Owner of another House, whichever House route they use', async () => {
    const seasonId = await activeSeason(
      viewer(world.first.member),
      world.first.houseId,
      'Autumn tables',
    );
    const otherOwner = viewer(world.second.member);

    await expect(
      closeSeason({ houseId: world.first.houseId, seasonId, viewer: otherOwner }, dependencies),
    ).rejects.toMatchObject({ code: 'authorization_denied', crossHouse: true });
    await expect(
      closeSeason({ houseId: world.second.houseId, seasonId, viewer: otherOwner }, dependencies),
    ).rejects.toMatchObject({ code: 'not_found' });
    const state = await database.query('select state from seasons where id = $1', [seasonId]);
    expect(state.rows).toEqual([{ state: 'active' }]);
  });

  it('[BM-047] AC3: after closing, a new activation still allows only one active Season', async () => {
    const owner = viewer(world.first.member);
    const closedSeasonId = await activeSeason(owner, world.first.houseId, 'Autumn tables');
    await closeSeason(
      { houseId: world.first.houseId, seasonId: closedSeasonId, viewer: owner },
      dependencies,
    );

    const nextSeasonId = await activeSeason(owner, world.first.houseId, 'Winter tables');
    await expect(
      draftSeason(
        {
          houseId: world.first.houseId,
          title: 'Spring tables',
          idempotencyKey: 'third-season',
          viewer: owner,
        },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      closeSeason(
        { houseId: world.first.houseId, seasonId: closedSeasonId, viewer: owner },
        dependencies,
      ),
    ).resolves.toMatchObject({ state: 'closed', closedNow: false });

    const seasons = await database.query(
      `select id::text, state from seasons where house_id = $1 order by created_at, id`,
      [world.first.houseId],
    );
    expect(seasons.rows).toEqual([
      { id: closedSeasonId, state: 'closed' },
      { id: nextSeasonId, state: 'active' },
    ]);
  });
});
