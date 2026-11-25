import {
  closeSeason,
  createAuthorizeHouseAction,
  createClosingBookConsumer,
  createOutboxDispatcher,
  draftSeason,
  draftSeasonCharter,
  publishSeason,
  readClosingBook,
  repairClosingBooks,
} from '@between-moves/application';
import {
  migrateDown,
  migrateUp,
  PgClosingBookRepository,
  PgHouseAuthorizationMembershipRepository,
  PgOutboxRepository,
  PgSeasonRepository,
} from '@between-moves/db';
import { twoHousesWithMembers, type TwoHousesWithMembers } from '@between-moves/db/testing';
import {
  HouseAuthorizationDeniedError,
  SEASON_CLOSING_TOPIC,
  type AuthenticatedViewer,
  type ClosingBookObservation,
  type Viewer,
} from '@between-moves/domain';
import { createDeliveryMetricStubs } from '@between-moves/observability';
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

/** An authenticated viewer for a fixture Member. */
function viewer(member: { readonly userId: string; readonly displayName: string }) {
  return {
    kind: 'authenticated',
    userId: member.userId,
    displayName: member.displayName,
    imageUrl: null,
  } satisfies AuthenticatedViewer;
}

describe('BM-048 Closing Book from Season close to House view', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const books = new PgClosingBookRepository(database);
  let world: TwoHousesWithMembers;
  let observations: ClosingBookObservation[];
  let now: number;
  let next = 5000;
  const ids = { generate: () => `01941f29-7c00-7000-8000-${String(next++).padStart(12, '0')}` };
  const clock = { now: () => new Date((now += 1_000)) };
  const authorizeHouseAction = createAuthorizeHouseAction({
    memberships: new PgHouseAuthorizationMembershipRepository(database),
    nightHosts: { isAssignedNightHost: async () => false },
    denials: { record: () => undefined },
  });
  const seasonDependencies = {
    authorizeHouseAction,
    clock,
    ids,
    seasons: new PgSeasonRepository(database),
    transitions: { record: () => undefined },
  };

  /** The worker's Closing Book consumer, recording each outcome for assertions. */
  function closingBookConsumer() {
    return createClosingBookConsumer({
      books,
      ids,
      clock,
      events: { record: (observation) => observations.push(observation) },
    });
  }

  /**
   * Run the worker's outbox dispatcher. A worker that predates Closing Books acknowledges every
   * event through its logging fallback, as the deployed BM-047 worker did.
   */
  function dispatch(worker: 'current' | 'before-closing-books' = 'current') {
    const closingBook = closingBookConsumer();
    return createOutboxDispatcher({
      clock,
      repository: new PgOutboxRepository(database),
      consumer: {
        consume: async (event) =>
          worker === 'current' && event.topic === SEASON_CLOSING_TOPIC
            ? closingBook.consume(event)
            : 'processed',
      },
      metrics: createDeliveryMetricStubs(),
    }).dispatchAvailable();
  }

  /** Read the latest Closing Book as `who` through House authorization. */
  function read(houseId: string, who: Viewer) {
    return readClosingBook({ houseId, viewer: who }, { authorizeHouseAction, books });
  }

  /** An active Season in the first House with one finished Game already on the ledger. */
  async function seasonWithAGame(): Promise<string> {
    const owner = viewer(world.first.member);
    const houseId = world.first.houseId;
    const draft = await draftSeason(
      { houseId, title: 'Autumn tables', idempotencyKey: 'bm-048-draft', viewer: owner },
      seasonDependencies,
    );
    await draftSeasonCharter(
      {
        houseId,
        seasonId: draft.seasonId,
        correspondencePaceHours: 24,
        nightRecurrence: { weekday: 5, localTime: '19:30', count: 4 },
        viewer: owner,
      },
      seasonDependencies,
    );
    await publishSeason(
      {
        houseId,
        seasonId: draft.seasonId,
        title: 'Autumn tables',
        startsAt,
        endsAt,
        viewer: owner,
      },
      seasonDependencies,
    );
    const gameId = ids.generate();
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, current_ply, result, result_reason, created_at, completed_at)
       values ($1, $2, $3, 'correspondence', 'completed', $4, $5,
               '{"kind":"correspondence","perMoveHours":24}', 41, 'white_win', 'resign',
               $6, $7)`,
      [
        gameId,
        houseId,
        draft.seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        startsAt,
        new Date('2026-09-12T18:00:00.000Z'),
      ],
    );
    for (const [membershipId, sourceKind, points] of [
      [world.first.member.membershipId, 'game_win', 3],
      [world.first.member.membershipId, 'game_played', 1],
      [world.first.nonOwner.membershipId, 'game_played', 1],
    ] as const) {
      await database.query(
        `insert into season_score_ledger
          (id, house_id, season_id, membership_id, source_kind, source_key, points, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          ids.generate(),
          houseId,
          draft.seasonId,
          membershipId,
          sourceKind,
          `${sourceKind}:${gameId}`,
          points,
          startsAt,
        ],
      );
    }
    return draft.seasonId;
  }

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    observations = [];
    now = Date.parse('2026-10-02T12:00:00.000Z');
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-048] AC1/AC2: closing a Season binds its Closing Book and every Member can read it', async () => {
    const seasonId = await seasonWithAGame();
    await expect(read(world.first.houseId, viewer(world.first.nonOwner))).resolves.toMatchObject({
      season: null,
      book: null,
    });

    await closeSeason(
      { houseId: world.first.houseId, seasonId, viewer: viewer(world.first.member) },
      seasonDependencies,
    );
    await expect(read(world.first.houseId, viewer(world.first.nonOwner))).resolves.toMatchObject({
      season: { seasonId, title: 'Autumn tables' },
      book: null,
    });

    const summary = await dispatch();

    expect(summary.failed).toBe(0);
    expect(observations).toEqual([
      expect.objectContaining({ houseId: world.first.houseId, seasonId, outcome: 'published' }),
    ]);
    for (const member of [world.first.member, world.first.nonOwner]) {
      const shelf = await read(world.first.houseId, viewer(member));
      expect(shelf).toMatchObject({
        houseName: world.first.name,
        season: { seasonId, title: 'Autumn tables' },
        book: { generationVersion: 1 },
      });
      expect(shelf?.book?.contents).toMatchObject({
        season: { seasonId, title: 'Autumn tables' },
        totals: { members: 3, gamesCompleted: 1, nightsHeld: 0, puzzlesPublished: 0 },
        games: [
          {
            white: { displayName: world.first.member.displayName },
            black: { displayName: world.first.nonOwner.displayName },
            result: 'white_win',
            resultReason: 'resign',
            plies: 41,
          },
        ],
        awards: [
          {
            kind: 'season_leader',
            value: 4,
            recipients: [{ displayName: world.first.member.displayName }],
          },
          { kind: 'most_games', value: 1 },
          { kind: 'most_wins', value: 1 },
        ],
      });
    }
  });

  it('[BM-048] a redelivered season.closing event leaves one published book', async () => {
    const seasonId = await seasonWithAGame();
    await closeSeason(
      { houseId: world.first.houseId, seasonId, viewer: viewer(world.first.member) },
      seasonDependencies,
    );
    await dispatch();
    const first = await read(world.first.houseId, viewer(world.first.member));
    await database.query(
      `update outbox_events set sent_at = null, available_at = $2 where topic = $1`,
      [SEASON_CLOSING_TOPIC, new Date(now)],
    );

    await dispatch();

    expect(observations.map((observation) => observation.outcome)).toEqual([
      'published',
      'duplicate',
    ]);
    await expect(read(world.first.houseId, viewer(world.first.member))).resolves.toEqual(first);
    const rows = await database.query('select state from closing_books');
    expect(rows.rows).toEqual([{ state: 'published' }]);
  });

  it('[BM-048] binds the book for a closing that an older worker acknowledged without one', async () => {
    const seasonId = await seasonWithAGame();
    await closeSeason(
      { houseId: world.first.houseId, seasonId, viewer: viewer(world.first.member) },
      seasonDependencies,
    );
    await dispatch('before-closing-books');
    await expect(read(world.first.houseId, viewer(world.first.nonOwner))).resolves.toMatchObject({
      season: { seasonId },
      book: null,
    });

    await expect(repairClosingBooks({ books, consumer: closingBookConsumer() })).resolves.toBe(1);

    const shelf = await read(world.first.houseId, viewer(world.first.nonOwner));
    expect(shelf?.book?.contents).toMatchObject({
      season: { seasonId, title: 'Autumn tables' },
      totals: { gamesCompleted: 1 },
    });
    await expect(repairClosingBooks({ books, consumer: closingBookConsumer() })).resolves.toBe(0);
    expect(observations.map((observation) => observation.outcome)).toEqual(['published']);
  });

  it('[BM-048] AC3: a non-member is denied another House’s Closing Book', async () => {
    const seasonId = await seasonWithAGame();
    await closeSeason(
      { houseId: world.first.houseId, seasonId, viewer: viewer(world.first.member) },
      seasonDependencies,
    );
    await dispatch();

    await expect(read(world.first.houseId, viewer(world.second.member))).rejects.toMatchObject(
      new HouseAuthorizationDeniedError('not_a_member', true),
    );
    await expect(read(world.first.houseId, { kind: 'anonymous' })).rejects.toBeInstanceOf(
      HouseAuthorizationDeniedError,
    );
    await expect(read(world.second.houseId, viewer(world.switchingMember))).resolves.toMatchObject({
      houseName: world.second.name,
      season: null,
      book: null,
    });
  });
});
