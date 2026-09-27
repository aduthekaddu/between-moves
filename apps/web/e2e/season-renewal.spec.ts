import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { makeSignature } from 'better-auth/crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const origin = 'http://127.0.0.1:3100';
const id = (value: number) => `01941f29-7c00-7000-8000-${String(value).padStart(12, '0')}`;
const autumnId = id(4971);
const charterId = id(4972);
const gameId = id(4973);
const fixtureHouseIds = [
  '01941f29-7c00-7000-8000-000000000601',
  '01941f29-7c00-7000-8000-000000000602',
];
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

/** The seeded database and Houses, once `beforeAll` has prepared them. */
function fixture(): { database: Database; world: TwoHousesWithMembers } {
  if (database === undefined || world === undefined) {
    throw new Error('Season renewal E2E fixture is not ready');
  }
  return { database, world };
}

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

/** A Better Auth session cookie for a fixture Member's session token. */
async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

/** A narrow, recorded browser for one Member, so the loop leaves a video for review. */
async function recordedBrowser(browser: Browser, token: string, requestId: string) {
  return browser.newContext({
    viewport: { width: 360, height: 900 },
    recordVideo: { dir: test.info().outputPath('videos'), size: { width: 360, height: 900 } },
    extraHTTPHeaders: { cookie: await signedCookie(token), 'x-request-id': requestId },
  });
}

/** Close a recorded browser and attach its video to the test report. */
async function closeRecorded(context: BrowserContext, page: Page, name: string): Promise<void> {
  const video = page.video();
  await context.close();
  if (video !== null) await test.info().attach(name, { path: await video.path() });
}

/** Fail on serious or critical axe violations and on horizontal overflow. */
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

/** A UTC calendar date `days` from today, as a date input expects it. */
function dateInput(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** Autumn tables, four weeks in: one finished Game and its points on the ledger. */
async function seedAutumn(): Promise<void> {
  const { database: db, world: houses } = fixture();
  const { first } = houses;
  const now = Date.now();
  const daysAgo = (days: number) => new Date(now - days * 86_400_000);
  await db.pool.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
    [autumnId, first.houseId, daysAgo(30)],
  );
  await db.pool.query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
       published_at, created_at)
     values ($1, $2, 1, 24, '{"weekday":5,"localTime":"19:30","count":4}',
             '{"completedGame":1,"win":2,"draw":1,"nightAttendance":1,"publishedPuzzle":1,"caps":{"games":8,"nights":4,"puzzles":2}}',
             $3, $3)`,
    [charterId, autumnId, daysAgo(30)],
  );
  await db.pool.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3, published_charter_version = 1
      where id = $1`,
    [autumnId, daysAgo(27), new Date(now + 86_400_000)],
  );
  await db.pool.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
       clock_policy, current_ply, result, result_reason, created_at, completed_at)
     values ($1, $2, $3, 'correspondence', 'completed', $4, $5,
             '{"kind":"correspondence","perMoveHours":24}', 7, 'white_win', 'checkmate', $6, $7)`,
    [
      gameId,
      first.houseId,
      autumnId,
      first.member.membershipId,
      first.nonOwner.membershipId,
      daysAgo(20),
      daysAgo(12),
    ],
  );
  for (const [ledgerId, membershipId, sourceKind, points] of [
    [id(4974), first.member.membershipId, 'game_win', 3],
    [id(4975), first.nonOwner.membershipId, 'game_played', 1],
  ] as const) {
    await db.pool.query(
      `insert into season_score_ledger
        (id, house_id, season_id, membership_id, source_kind, source_key, points, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        ledgerId,
        first.houseId,
        autumnId,
        membershipId,
        sourceKind,
        `game:${gameId}:${sourceKind}`,
        points,
        daysAgo(12),
      ],
    );
  }
}

/**
 * Publish pending Closing Books through the worker's `season.closing` path in its own process
 * (see `support/closing-book-worker.ts` for why the spec does not import the worker).
 */
async function runClosingBookWorker(): Promise<void> {
  const { stdout } = await promisify(execFile)(
    'pnpm',
    ['exec', 'tsx', fileURLToPath(new URL('./support/closing-book-worker.ts', import.meta.url))],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env },
  );
  expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toMatchObject({ failed: 0 });
}

test.describe('BM-049 Season renewal', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for renewal E2E');

  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl ?? '');
    await purgeFixtureLedger(database);
    await resetTwoHousesWithMembers(database.pool);
    world = await twoHousesWithMembers(database.pool);
    const { first } = world;
    await database.pool.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, '2099-01-01T00:00:00.000Z'),
              ($4, $5, $6, '2099-01-01T00:00:00.000Z')`,
      [
        first.member.sessionId,
        first.member.userId,
        first.member.sessionToken,
        first.nonOwner.sessionId,
        first.nonOwner.userId,
        first.nonOwner.sessionToken,
      ],
    );
    await seedAutumn();
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await purgeFixtureLedger(database);
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-049] closes, is read by a Member, and renews into a fresh Season', async ({
    browser,
    request,
  }) => {
    const { database: db, world: houses } = fixture();
    const { first } = houses;
    const season = `/h/${first.houseId}/season`;
    const closingBook = `/h/${first.houseId}/closing-book`;

    // Close: the Owner freezes Autumn tables from the Season page.
    const owner = await recordedBrowser(browser, first.member.sessionToken, 'bm-049-owner-e2e');
    const ownerPage = await owner.newPage();
    await ownerPage.goto(season);
    await ownerPage.getByRole('button', { name: 'Close Season' }).click();
    await ownerPage
      .getByRole('group', { name: 'Confirm Season close' })
      .getByRole('button', { name: 'Close and finalize standings' })
      .click();
    await expect(ownerPage.getByText('Season closed · Final standings')).toBeVisible();
    await expect(ownerPage.getByRole('heading', { level: 1 })).toHaveText('Publish a Charter');
    await expect(ownerPage.getByText('The next Season', { exact: true })).toBeVisible();
    await expect(ownerPage.getByText('Nothing carries over from Autumn tables')).toBeVisible();
    await expect(ownerPage.getByLabel('Season title')).toHaveValue('');
    await runClosingBookWorker();

    // Non-owner view: a Member reads the book from the final standings.
    const member = await recordedBrowser(browser, first.nonOwner.sessionToken, 'bm-049-member-e2e');
    const memberPage = await member.newPage();
    await memberPage.goto(season);
    await expect(
      memberPage.getByText(
        'Autumn tables is closed. When an Owner or Steward publishes the next Charter, a new Season starts from zero.',
      ),
    ).toBeVisible();
    await memberPage.getByRole('link', { name: 'Read the Closing Book' }).click();
    await expect(memberPage).toHaveURL(closingBook);
    const book = memberPage.getByRole('article', { name: 'Autumn tables' });
    await expect(book.getByText('Finished first with 3 points.')).toBeVisible();
    await expect(book.getByText('Ada beat Bea by checkmate')).toBeVisible();
    const memberNext = memberPage.getByRole('region', { name: 'The table is open.' });
    await expect(memberNext).toContainText('When an Owner or Steward publishes the next Charter');
    await expect(memberNext.getByRole('link')).toHaveCount(0);
    await expectAccessible(memberPage);

    // Renew: the Owner goes from the book's last page into the next Charter.
    await ownerPage.goto(closingBook);
    const ownerNext = ownerPage.getByRole('region', { name: 'The table is open.' });
    await expect(ownerNext).toContainText('Nothing carries over from Autumn tables');
    await expectAccessible(ownerPage);
    await ownerNext.getByRole('link', { name: 'Start the next Season' }).click();
    await expect(ownerPage).toHaveURL(season);
    await ownerPage.getByLabel('Season title').fill('Winter tables');
    await ownerPage.getByLabel('Season starts').fill(dateInput(7));
    await ownerPage.getByLabel('Season ends').fill(dateInput(35));
    await ownerPage.getByLabel('Correspondence pace').fill('48');
    await ownerPage.getByLabel('Weekday').selectOption('2');
    await ownerPage.getByRole('button', { name: 'Publish Charter' }).click();
    const published = ownerPage.getByRole('status');
    await expect(published.getByRole('heading', { level: 1 })).toHaveText('Winter tables');
    await expect(published).toContainText('Charter version 1 is published.');
    await expect(
      published.getByRole('link', { name: 'Read the Autumn tables Closing Book' }),
    ).toBeVisible();
    await expect(ownerPage.getByText('Final standings')).toHaveCount(0);

    await ownerPage.reload();
    await expect(ownerPage.getByText('Season active', { exact: true })).toBeVisible();
    await expect(ownerPage.getByText('48 hours per Move')).toBeVisible();
    await expect(ownerPage.getByRole('heading', { name: /^Night [1-4]$/ })).toHaveCount(4);
    await expect(ownerPage.getByText('Final standings')).toHaveCount(0);
    await expectAccessible(ownerPage);

    const seasons = await db.pool.query<{ id: string; title: string; state: string }>(
      `select id::text, title, state from seasons where house_id = $1 order by created_at, id`,
      [first.houseId],
    );
    expect(seasons.rows.map(({ title, state }) => [title, state])).toEqual([
      ['Autumn tables', 'closed'],
      ['Winter tables', 'active'],
    ]);
    const winterId = seasons.rows[1]?.id ?? '';
    const memberCookie = await signedCookie(first.nonOwner.sessionToken);
    const winterStandings = await request.get(
      `/api/houses/${first.houseId}/seasons/${winterId}/standings`,
      { headers: { cookie: memberCookie, origin } },
    );
    expect(winterStandings.status()).toBe(200);
    await expect(winterStandings.json()).resolves.toMatchObject({
      seasonId: winterId,
      finalized: false,
      standings: [],
    });
    const autumnStandings = await request.get(
      `/api/houses/${first.houseId}/seasons/${autumnId}/standings`,
      { headers: { cookie: memberCookie, origin } },
    );
    await expect(autumnStandings.json()).resolves.toMatchObject({
      finalized: true,
      standings: [
        { membershipId: first.member.membershipId, points: 3 },
        { membershipId: first.nonOwner.membershipId, points: 1 },
        { membershipId: houses.switchingMember.firstMembershipId, points: 0 },
      ],
    });

    // Return: the Member finds the last book again from the renewed Season.
    await memberPage.goto(season);
    await expect(memberPage.getByRole('heading', { level: 1 })).toHaveText('Winter tables');
    await expect(memberPage.getByText('Final standings')).toHaveCount(0);
    await expectAccessible(memberPage);
    await memberPage.getByRole('link', { name: 'Read the Autumn tables Closing Book' }).click();
    await expect(memberPage).toHaveURL(closingBook);
    await expect(memberPage.getByRole('article', { name: 'Autumn tables' })).toBeVisible();
    const underWay = memberPage.getByRole('region', { name: 'Winter tables is under way.' });
    await expect(underWay).toContainText('started again from zero');
    await expect(underWay.getByRole('link', { name: 'Open the Season table' })).toHaveAttribute(
      'href',
      season,
    );
    await expectAccessible(memberPage);
    await memberPage.setViewportSize({ width: 1280, height: 900 });
    await expectAccessible(memberPage);
    await memberPage.screenshot({
      path: test.info().outputPath('closing-book-after-renewal.png'),
      fullPage: true,
    });

    const persisted = await db.pool.query(
      `select s.title,
              (select count(*)::int from season_score_ledger l where l.season_id = s.id) as ledger,
              (select count(*)::int from house_nights n where n.season_id = s.id) as nights,
              (select count(*)::int from closing_books b
                where b.season_id = s.id and b.state = 'published') as books
         from seasons s where s.house_id = $1 order by s.created_at, s.id`,
      [first.houseId],
    );
    expect(persisted.rows).toEqual([
      { title: 'Autumn tables', ledger: 2, nights: 0, books: 1 },
      { title: 'Winter tables', ledger: 0, nights: 4, books: 0 },
    ]);

    await closeRecorded(owner, ownerPage, 'owner-close-and-renew');
    await closeRecorded(member, memberPage, 'member-reads-and-returns');
  });
});
