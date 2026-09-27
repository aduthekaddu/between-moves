import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createClosingBookConsumer, createOutboxDispatcher } from '@between-moves/application';
import { PgClosingBookRepository, PgOutboxRepository } from '@between-moves/db';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { SEASON_CLOSING_TOPIC } from '@between-moves/domain';
import { createDeliveryMetricStubs } from '@between-moves/observability';
import { makeSignature } from 'better-auth/crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const origin = 'http://127.0.0.1:3100';
const id = (value: number) => `01941f29-7c00-7000-8000-${String(value).padStart(12, '0')}`;
const seasonId = id(4951);
const charterId = id(4952);
const gameWon = id(4953);
const gameDrawn = id(4954);
const nightIds = [id(4955), id(4956)];
const scholarsMate = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
const scholarsSan = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
const beforeNf6 = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;
let nextId = 4960;

const fixtureHouseIds = [
  '01941f29-7c00-7000-8000-000000000601',
  '01941f29-7c00-7000-8000-000000000602',
];

/**
 * The points ledger is immutable by design, so a Season that scored can never be deleted.
 * Test cleanup alone lifts the trigger for one transaction to let the shared reset run again.
 */
async function purgeFixtureLedger(db: Database): Promise<void> {
  const client = await db.pool.connect();
  try {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query('delete from season_score_ledger where house_id = any($1::uuid[])', [
      fixtureHouseIds,
    ]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function fixture(): { database: Database; world: TwoHousesWithMembers } {
  if (database === undefined || world === undefined) {
    throw new Error('Closing Book E2E fixture is not ready');
  }
  return { database, world };
}

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

async function expectAccessible(page: Page): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(
    scan.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

/** A Season four weeks in: two finished Games, analysed swings, a House Puzzle, two Nights. */
async function seedSeason(): Promise<void> {
  const { database: db, world: houses } = fixture();
  const { first } = houses;
  const ada = first.member.membershipId;
  const bea = first.nonOwner.membershipId;
  const mira = houses.switchingMember.firstMembershipId;
  const now = Date.now();
  const daysAgo = (days: number, hour = 18) =>
    new Date(Math.floor(now / 86_400_000 - days) * 86_400_000 + hour * 3_600_000);
  const query = (sql: string, values: readonly unknown[]) => db.pool.query(sql, [...values]);

  await query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
    [seasonId, first.houseId, daysAgo(30)],
  );
  await query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
       published_at, created_at)
     values ($1, $2, 1, 24, '{"weekday":5,"localTime":"19:30","count":4}',
             '{"completedGame":1,"win":2,"draw":1,"nightAttendance":1,"publishedPuzzle":1,"caps":{"games":8,"nights":4,"puzzles":2}}',
             $3, $3)`,
    [charterId, seasonId, daysAgo(30)],
  );
  await query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3, published_charter_version = 1
      where id = $1`,
    [seasonId, daysAgo(27, 0), new Date(now + 86_400_000)],
  );
  for (const [gameId, white, black, result, reason, plies, completedAt] of [
    [gameWon, ada, bea, 'white_win', 'checkmate', 7, daysAgo(20)],
    [gameDrawn, bea, mira, 'draw', 'agreement', 4, daysAgo(9)],
  ] as const) {
    await query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, current_ply, result, result_reason, created_at, completed_at)
       values ($1, $2, $3, 'correspondence', 'completed', $4, $5,
               '{"kind":"correspondence","perMoveHours":24}', $6, $7, $8, $9, $10)`,
      [
        gameId,
        first.houseId,
        seasonId,
        white,
        black,
        plies,
        result,
        reason,
        daysAgo(26),
        completedAt,
      ],
    );
    for (let ply = 1; ply <= plies; ply += 1) {
      await query(
        `insert into moves
          (id, game_id, house_id, ply, actor_membership_id, uci, san, fen_after,
           client_command_id, server_received_at, accepted_version)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $4)`,
        [
          id(nextId++),
          gameId,
          first.houseId,
          ply,
          ply % 2 === 1 ? white : black,
          scholarsMate[ply - 1],
          scholarsSan[ply - 1],
          beforeNf6,
          id(nextId++),
          daysAgo(25),
        ],
      );
    }
  }
  const candidates: string[] = [];
  for (const [gameId, ply, swingCp, at] of [
    [gameWon, 6, 950, daysAgo(20, 19)],
    [gameDrawn, 3, 320, daysAgo(9, 19)],
  ] as const) {
    const jobId = id(nextId++);
    const candidateId = id(nextId++);
    candidates.push(candidateId);
    await query(
      `insert into analysis_jobs
        (id, source_event_id, game_id, house_id, engine_version, state, result, created_at,
         completed_at)
       values ($1, $2, $3, $4, 'v1', 'completed', '{"swings":[]}', $5, $5)`,
      [jobId, id(nextId++), gameId, first.houseId, at],
    );
    await query(
      `insert into puzzle_candidates
        (id, analysis_job_id, game_id, house_id, season_id, source_ply, position_fen,
         best_line, evaluation_swing_cp, state, reviewer_membership_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, '["g7g6"]', $8, $9, $10, $11)`,
      [
        candidateId,
        jobId,
        gameId,
        first.houseId,
        seasonId,
        ply,
        beforeNf6,
        swingCp,
        ply === 6 ? 'confirmed' : 'pending',
        ply === 6 ? ada : null,
        at,
      ],
    );
  }
  await query(
    `insert into house_puzzles
      (id, candidate_id, house_id, season_id, game_id, position_fen, prompt,
       contributor_membership_id, confirmed_by_membership_id, published_at)
     values ($1, $2, $3, $4, $5, $6, 'Black to move. Stop the mate before it lands.', $7, $7, $8)`,
    [id(nextId++), candidates[0], first.houseId, seasonId, gameWon, beforeNf6, ada, daysAgo(18)],
  );
  for (const [index, nightId] of nightIds.entries()) {
    const startedAt = daysAgo(21 - index * 7, 14);
    await query(
      `insert into house_nights
        (id, house_id, season_id, scheduled_start, scheduled_end, state, started_at, ended_at)
       values ($1, $2, $3, $4, $5, 'ended', $4, $5)`,
      [nightId, first.houseId, seasonId, startedAt, new Date(startedAt.getTime() + 7_200_000)],
    );
  }
  for (const [nightId, membershipId] of [
    [nightIds[0], ada],
    [nightIds[1], ada],
    [nightIds[1], mira],
  ] as const) {
    const joinedAt = daysAgo(21, 14);
    await query(
      `insert into night_attendance
        (id, house_id, night_id, membership_id, first_joined_at, accumulated_seconds,
         qualified_at, qualification_reason, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 1800, $6, 'duration', $5, $5)`,
      [
        id(nextId++),
        first.houseId,
        nightId,
        membershipId,
        joinedAt,
        new Date(joinedAt.getTime() + 1_800_000),
      ],
    );
  }
  for (const [membershipId, sourceKind, points] of [
    [ada, 'game_win', 3],
    [ada, 'game_played', 1],
    [ada, 'night_attendance', 1],
    [ada, 'night_attendance', 1],
    [ada, 'puzzle_published', 1],
    [bea, 'game_played', 1],
    [bea, 'game_draw', 2],
    [mira, 'game_draw', 2],
    [mira, 'night_attendance', 1],
  ] as const) {
    await query(
      `insert into season_score_ledger
        (id, house_id, season_id, membership_id, source_kind, source_key, points, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id(nextId++),
        first.houseId,
        seasonId,
        membershipId,
        sourceKind,
        `e2e:${nextId}`,
        points,
        daysAgo(8),
      ],
    );
  }
}

/** The worker's outbox path, composed exactly as in apps/worker for `season.closing`. */
async function runClosingBookWorker(): Promise<void> {
  const { database: db } = fixture();
  const clock = { now: () => new Date() };
  const closingBook = createClosingBookConsumer({
    books: new PgClosingBookRepository(db.pool),
    ids: { generate: () => id(nextId++) },
    clock,
    events: { record: () => undefined },
  });
  const summary = await createOutboxDispatcher({
    clock,
    repository: new PgOutboxRepository(db.pool),
    consumer: {
      consume: async (event) =>
        event.topic === SEASON_CLOSING_TOPIC ? closingBook.consume(event) : 'processed',
    },
    metrics: createDeliveryMetricStubs(),
  }).dispatchAvailable();
  expect(summary.failed).toBe(0);
}

test.describe('BM-048 Closing Book', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for Closing Book E2E');

  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl ?? '');
    await purgeFixtureLedger(database);
    await resetTwoHousesWithMembers(database.pool);
    world = await twoHousesWithMembers(database.pool);
    const { first, second } = world;
    await database.pool.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, '2099-01-01T00:00:00.000Z'),
              ($4, $5, $6, '2099-01-01T00:00:00.000Z'),
              ($7, $8, $9, '2099-01-01T00:00:00.000Z')`,
      [
        first.member.sessionId,
        first.member.userId,
        first.member.sessionToken,
        first.nonOwner.sessionId,
        first.nonOwner.userId,
        first.nonOwner.sessionToken,
        second.member.sessionId,
        second.member.userId,
        second.member.sessionToken,
      ],
    );
    await seedSeason();
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await purgeFixtureLedger(database);
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-048] a closed Season’s book is published and every Member can read it', async ({
    browser,
    request,
  }) => {
    const { database: db, world: houses } = fixture();
    const { first } = houses;
    const close = await request.post(`/api/houses/${first.houseId}/seasons/${seasonId}/close`, {
      headers: { cookie: await signedCookie(first.member.sessionToken), origin },
    });
    expect(close.status()).toBe(200);

    const member = await browser.newContext({
      viewport: { width: 360, height: 900 },
      extraHTTPHeaders: {
        cookie: await signedCookie(first.nonOwner.sessionToken),
        'x-request-id': 'bm-048-member-e2e',
      },
    });
    const page = await member.newPage();
    await page.goto(`/h/${first.houseId}/closing-book`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Being bound.');
    await expect(page.getByText('Autumn tables has closed.')).toBeVisible();
    await expectAccessible(page);

    await runClosingBookWorker();

    await page.goto(`/h/${first.houseId}/season`);
    await expect(page.getByText('Season closed · Final standings')).toBeVisible();
    await page.getByRole('link', { name: 'Read the Closing Book' }).click();
    await expect(page).toHaveURL(`/h/${first.houseId}/closing-book`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );

    const book = page.getByRole('article', { name: 'Autumn tables' });
    await expect(book.getByRole('heading', { level: 1 })).toHaveText('Autumn tables');
    await expect(book.getByText(`Closing Book · ${first.name}`)).toBeVisible();

    const awards = book.getByRole('region', { name: 'Season awards' });
    await expect(awards.getByRole('listitem')).toHaveCount(5);
    await expect(awards.getByText('Finished first with 7 points.')).toBeVisible();
    await expect(awards.getByText('Finished 2 games, the most this Season.')).toBeVisible();

    const roll = book.getByRole('region', { name: 'Who turned up' });
    await expect(roll.getByRole('listitem')).toHaveCount(3);
    await expect(roll.getByText('2 games: 1 drawn, 1 lost')).toBeVisible();

    const swings = book.getByRole('region', { name: 'Memorable swings' });
    await expect(swings.getByRole('listitem')).toHaveCount(2);
    await expect(swings.getByText('3… Nf6')).toBeVisible();
    await expect(swings.getByText('9.5')).toBeVisible();

    const games = book.getByRole('region', { name: 'Every game finished' });
    await expect(games.getByRole('listitem')).toHaveCount(2);
    await expect(games.getByText('Ada beat Bea by checkmate')).toBeVisible();

    const puzzles = book.getByRole('region', { name: 'House Puzzles' });
    await expect(puzzles.getByText('Black to move. Stop the mate before it lands.')).toBeVisible();
    await expect(puzzles.getByRole('img', { name: `Chess position: ${beforeNf6}` })).toBeVisible();

    await expectAccessible(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath('closing-book-published.png'),
      fullPage: true,
    });

    const persisted = await db.pool.query(
      `select state, generation_version, published_at is not null as published
         from closing_books where season_id = $1`,
      [seasonId],
    );
    expect(persisted.rows).toEqual([
      { state: 'published', generation_version: 1, published: true },
    ]);
    await member.close();
  });

  test('[BM-048] a non-member is denied the House’s Closing Book', async ({ browser }) => {
    const { world: houses } = fixture();
    const outsider = await browser.newContext({
      extraHTTPHeaders: { cookie: await signedCookie(houses.second.member.sessionToken) },
    });
    const page = await outsider.newPage();

    const response = await page.goto(`/h/${houses.first.houseId}/closing-book`);

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'This House is not available.' })).toBeVisible();
    await expect(page.getByText('Autumn tables')).toHaveCount(0);
    await outsider.close();
  });
});
