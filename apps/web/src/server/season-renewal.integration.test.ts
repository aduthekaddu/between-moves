import {
  closeSeason,
  createAuthorizeHouseAction,
  createClosingBookConsumer,
  createOutboxDispatcher,
  createSeasonScoringConsumer,
  draftSeason,
  draftSeasonCharter,
  publishSeason,
  readClosingBook,
  readHouseSeason,
  readLastClosedSeason,
  readScheduledNights,
  readSeasonStandings,
} from '@between-moves/application';
import {
  migrateDown,
  migrateUp,
  PgClosingBookRepository,
  PgHouseAuthorizationMembershipRepository,
  PgNightRepository,
  PgOutboxRepository,
  PgSeasonRepository,
  PgSeasonScoringRepository,
} from '@between-moves/db';
import { twoHousesWithMembers, type TwoHousesWithMembers } from '@between-moves/db/testing';
import {
  GAME_COMPLETED_SCORING_TOPIC,
  SEASON_CLOSING_TOPIC,
  type AuthenticatedViewer,
  type SeasonTransitionObservation,
} from '@between-moves/domain';
import { createDeliveryMetricStubs, createStructuredLogger } from '@between-moves/observability';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createClosingBookReader } from '../modules/stories/closingBook';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);
const autumn = {
  title: 'Autumn tables',
  startsAt: new Date('2026-09-04T00:00:00.000Z'),
  endsAt: new Date('2026-10-02T00:00:00.000Z'),
  paceHours: 24,
  weekday: 5,
};
const winter = {
  title: 'Winter tables',
  startsAt: new Date('2026-10-09T00:00:00.000Z'),
  endsAt: new Date('2026-11-06T00:00:00.000Z'),
  paceHours: 48,
  weekday: 2,
};

/** An authenticated viewer for a fixture Member. */
function viewer(member: { readonly userId: string; readonly displayName: string }) {
  return {
    kind: 'authenticated',
    userId: member.userId,
    displayName: member.displayName,
    imageUrl: null,
  } satisfies AuthenticatedViewer;
}

describe('BM-049 Season renewal and the non-owner Closing Book view', () => {
  const database = new Pool({ connectionString: testDatabaseUrl, max: 8 });
  const books = new PgClosingBookRepository(database);
  const scoring = new PgSeasonScoringRepository(database);
  const nights = new PgNightRepository(database);
  let world: TwoHousesWithMembers;
  let transitions: SeasonTransitionObservation[];
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
    transitions: {
      record: (observation: SeasonTransitionObservation) => transitions.push(observation),
    },
  };

  /** Draft, charter, and publish one Season through the Owner's three Charter commands. */
  async function publishCharter(
    owner: AuthenticatedViewer,
    season: typeof autumn,
    idempotencyKey: string,
  ): Promise<string> {
    const houseId = world.first.houseId;
    const draft = await draftSeason(
      { houseId, title: season.title, idempotencyKey, viewer: owner },
      seasonDependencies,
    );
    await draftSeasonCharter(
      {
        houseId,
        seasonId: draft.seasonId,
        correspondencePaceHours: season.paceHours,
        nightRecurrence: { weekday: season.weekday, localTime: '19:30', count: 4 },
        viewer: owner,
      },
      seasonDependencies,
    );
    await publishSeason(
      {
        houseId,
        seasonId: draft.seasonId,
        title: season.title,
        startsAt: season.startsAt,
        endsAt: season.endsAt,
        viewer: owner,
      },
      seasonDependencies,
    );
    return draft.seasonId;
  }

  /** Append one fixed-recipe ledger entry to a Season, recorded before it closes. */
  async function award(
    seasonId: string,
    membershipId: string,
    sourceKind: 'game_win' | 'game_played',
  ): Promise<void> {
    await database.query(
      `insert into season_score_ledger
        (id, house_id, season_id, membership_id, source_kind, source_key, points, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        ids.generate(),
        world.first.houseId,
        seasonId,
        membershipId,
        sourceKind,
        `bm-049:${next}`,
        sourceKind === 'game_win' ? 3 : 1,
        new Date('2026-09-20T12:00:00.000Z'),
      ],
    );
  }

  /** Autumn tables, scored and closed by the Owner, with its Closing Book bound. */
  async function closedAutumn(): Promise<string> {
    const owner = viewer(world.first.member);
    const seasonId = await publishCharter(owner, autumn, 'bm-049-autumn');
    await award(seasonId, world.first.member.membershipId, 'game_win');
    await award(seasonId, world.first.nonOwner.membershipId, 'game_played');
    await closeSeason(
      { houseId: world.first.houseId, seasonId, viewer: owner },
      seasonDependencies,
    );
    const closingBook = createClosingBookConsumer({
      books,
      ids,
      clock,
      events: { record: () => undefined },
    });
    await createOutboxDispatcher({
      clock,
      repository: new PgOutboxRepository(database),
      consumer: {
        consume: async (event) =>
          event.topic === SEASON_CLOSING_TOPIC ? closingBook.consume(event) : 'processed',
      },
      metrics: createDeliveryMetricStubs(),
    }).dispatchAvailable();
    return seasonId;
  }

  /** Read a Season's standings as `who` through House authorization. */
  function standings(seasonId: string, who: AuthenticatedViewer) {
    return readSeasonStandings(
      { houseId: world.first.houseId, seasonId, viewer: who },
      { authorizeHouseAction, scoring },
    );
  }

  /** Read the Closing Book through the web request seam, collecting its structured log lines. */
  function readBookAs(who: AuthenticatedViewer, lines: string[]) {
    const logClock = { now: () => new Date('2026-10-03T09:00:00.000Z') };
    return createClosingBookReader({
      getViewer: async () => who,
      readClosingBook: (query) => readClosingBook(query, { authorizeHouseAction, books }),
      logger: createStructuredLogger({ clock: logClock, sink: (line) => lines.push(line) }),
      clock: logClock,
    })(
      new Request(`https://betweenmoves.test/h/${world.first.houseId}/closing-book`, {
        headers: { 'x-request-id': 'bm-049-closing-book-view' },
      }),
      world.first.houseId,
    );
  }

  /** The `bm.closing_book.viewed` lines among collected log output. */
  function views(lines: readonly string[]) {
    return lines
      .map((line) => JSON.parse(line) as { event: string; data: Record<string, unknown> })
      .filter((line) => line.event === 'bm.closing_book.viewed');
  }

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    transitions = [];
    now = Date.parse('2026-10-02T12:00:00.000Z');
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-049] AC1: an Owner’s new Charter starts an active Season with nothing carried over', async () => {
    const owner = viewer(world.first.member);
    const member = viewer(world.first.nonOwner);
    const autumnId = await closedAutumn();
    const autumnStandings = await standings(autumnId, member);
    transitions = [];

    const winterId = await publishCharter(owner, winter, 'bm-049-winter');

    expect(winterId).not.toBe(autumnId);
    expect(
      transitions.map(({ seasonId, event, to, outcome }) => [seasonId, event, to, outcome]),
    ).toEqual([
      [winterId, 'draft_season', 'draft', 'success'],
      [winterId, 'publish_season', 'active', 'success'],
    ]);
    await expect(
      readHouseSeason(
        { houseId: world.first.houseId, viewer: member },
        { authorizeHouseAction, seasons: new PgSeasonRepository(database) },
      ),
    ).resolves.toMatchObject({
      seasonId: winterId,
      title: 'Winter tables',
      state: 'active',
      startsAt: winter.startsAt,
      charter: {
        version: 1,
        correspondencePaceHours: 48,
        nightRecurrence: { weekday: 2, localTime: '19:30', count: 4 },
      },
    });
    await expect(standings(winterId, member)).resolves.toEqual({
      houseId: world.first.houseId,
      seasonId: winterId,
      finalized: false,
      standings: [],
    });
    await expect(standings(autumnId, member)).resolves.toEqual(autumnStandings);
    expect(autumnStandings).toMatchObject({
      finalized: true,
      standings: [
        { membershipId: world.first.member.membershipId, points: 3 },
        { membershipId: world.first.nonOwner.membershipId, points: 1 },
        { membershipId: world.switchingMember.firstMembershipId, points: 0 },
      ],
    });
    const schedule = await readScheduledNights(
      { houseId: world.first.houseId, viewer: member },
      { authorizeHouseAction, nights },
    );
    expect(schedule).toHaveLength(4);
    expect(new Set(schedule.map((night) => night.seasonId))).toEqual(new Set([winterId]));
    await expect(
      readLastClosedSeason(
        { houseId: world.first.houseId, viewer: member },
        { authorizeHouseAction, seasons: new PgSeasonRepository(database) },
      ),
    ).resolves.toMatchObject({ seasonId: autumnId, state: 'closed' });
    const seasons = await database.query(
      `select s.id::text, s.state,
              (select count(*)::int from season_score_ledger l where l.season_id = s.id) as ledger,
              (select count(*)::int from season_final_standings f where f.season_id = s.id)
                as final_standings,
              (select count(*)::int from closing_books b where b.season_id = s.id) as books
         from seasons s where s.house_id = $1 order by s.created_at, s.id`,
      [world.first.houseId],
    );
    expect(seasons.rows).toEqual([
      { id: autumnId, state: 'closed', ledger: 2, final_standings: 3, books: 1 },
      { id: winterId, state: 'active', ledger: 0, final_standings: 0, books: 0 },
    ]);
  });

  it('[BM-049] AC1: an Autumn game finishing after renewal scores only its own Season', async () => {
    const owner = viewer(world.first.member);
    const member = viewer(world.first.nonOwner);
    const autumnId = await closedAutumn();
    const frozen = await standings(autumnId, member);
    const winterId = await publishCharter(owner, winter, 'bm-049-winter');
    const lateGameId = ids.generate();
    const finishedAt = new Date('2026-10-12T18:00:00.000Z');
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, current_ply, result, result_reason, created_at, completed_at,
         season_completion_sequence)
       values ($1, $2, $3, 'correspondence', 'completed', $4, $5,
               '{"kind":"correspondence","perMoveHours":24}', 7, 'white_win', 'checkmate', $6, $7,
               1)`,
      [
        lateGameId,
        world.first.houseId,
        autumnId,
        world.first.nonOwner.membershipId,
        world.first.member.membershipId,
        autumn.startsAt,
        finishedAt,
      ],
    );

    await expect(
      createSeasonScoringConsumer({
        scoring,
        ids,
        clock,
        events: { record: () => undefined },
      }).consume({
        id: ids.generate(),
        topic: GAME_COMPLETED_SCORING_TOPIC,
        aggregateId: lateGameId,
        sequence: 1n,
        houseId: world.first.houseId,
        payload: { gameId: lateGameId },
        availableAt: finishedAt,
        occurredAt: finishedAt,
        attempts: 1,
      }),
    ).resolves.toBe('processed');

    await expect(standings(winterId, member)).resolves.toMatchObject({ standings: [] });
    await expect(standings(autumnId, member)).resolves.toEqual(frozen);
    const ledger = await database.query(
      `select season_id::text, count(*)::int as entries
         from season_score_ledger where house_id = $1 group by season_id`,
      [world.first.houseId],
    );
    expect(ledger.rows).toEqual([{ season_id: autumnId, entries: 4 }]);
  });

  it('[BM-049] AC2: a Member’s Closing Book view records their non-owner role', async () => {
    const autumnId = await closedAutumn();
    const lines: string[] = [];

    const shelf = await readBookAs(viewer(world.first.nonOwner), lines);

    expect(shelf).toMatchObject({
      membershipId: world.first.nonOwner.membershipId,
      membershipRole: 'member',
      season: { seasonId: autumnId },
      activeSeason: null,
      book: { contents: { season: { title: 'Autumn tables' } } },
    });
    expect(views(lines)).toEqual([
      expect.objectContaining({
        request_id: 'bm-049-closing-book-view',
        actor_id: world.first.nonOwner.userId,
        house_id: world.first.houseId,
        outcome: 'success',
        data: {
          season_id: autumnId,
          closing_book_id: shelf?.book?.bookId,
          generation_version: 1,
          actor_membership_id: world.first.nonOwner.membershipId,
          actor_role: 'member',
        },
      }),
    ]);
  });

  it('[BM-049] tells each reader’s role apart, before and after the House renews', async () => {
    const autumnId = await closedAutumn();
    const lines: string[] = [];
    await readBookAs(viewer(world.first.member), lines);
    await readBookAs(viewer(world.switchingMember), lines);
    const winterId = await publishCharter(viewer(world.first.member), winter, 'bm-049-winter');

    const renewed = await readBookAs(viewer(world.first.nonOwner), lines);

    expect(renewed).toMatchObject({
      season: { seasonId: autumnId },
      activeSeason: { seasonId: winterId, title: 'Winter tables' },
    });
    expect(
      views(lines).map(({ data }) => [data.season_id, data.actor_membership_id, data.actor_role]),
    ).toEqual([
      [autumnId, world.first.member.membershipId, 'owner'],
      [autumnId, world.switchingMember.firstMembershipId, 'steward'],
      [autumnId, world.first.nonOwner.membershipId, 'member'],
    ]);
  });

  it('[BM-049] lets only an Owner or Steward renew a closed House', async () => {
    await closedAutumn();

    await expect(
      draftSeason(
        {
          houseId: world.first.houseId,
          title: winter.title,
          idempotencyKey: 'bm-049-member',
          viewer: viewer(world.first.nonOwner),
        },
        seasonDependencies,
      ),
    ).rejects.toMatchObject({ code: 'authorization_denied', reason: 'role_not_permitted' });
    const stewardSeasonId = await publishCharter(
      viewer(world.switchingMember),
      winter,
      'bm-049-steward',
    );

    const seasons = await database.query(
      `select id::text, state from seasons where house_id = $1 and state <> 'closed'`,
      [world.first.houseId],
    );
    expect(seasons.rows).toEqual([{ id: stewardSeasonId, state: 'active' }]);
  });
});
