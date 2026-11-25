import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { makeSignature } from 'better-auth/crypto';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const seasonId = '01941f29-7c00-7000-8000-000000004901';
const charterId = '01941f29-7c00-7000-8000-000000004902';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('Season close E2E fixture is not ready');
  return world;
}

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

async function expectAccessibleNarrowLayout(page: Page): Promise<void> {
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

test.describe('BM-047 Season close', () => {
  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl);
    await resetTwoHousesWithMembers(database.pool);
    world = await twoHousesWithMembers(database.pool);
    const { first } = fixture();
    const now = new Date();
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
    await database.pool.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
      [seasonId, first.houseId, now],
    );
    await database.pool.query(
      `insert into season_charters
        (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe,
         published_at, created_at)
       values ($1, $2, 1, 24, '{"weekday":5,"localTime":"19:30","count":4}',
               '{"completedGame":1,"win":2,"draw":1,"nightAttendance":1,"publishedPuzzle":1,"caps":{"games":8,"nights":4,"puzzles":2}}',
               $3, $3)`,
      [charterId, seasonId, now],
    );
    await database.pool.query(
      `update seasons
          set state = 'active', starts_at = $2, ends_at = $3, published_charter_version = 1
        where id = $1`,
      [seasonId, new Date(now.getTime() - 27 * 86_400_000), new Date(now.getTime() + 86_400_000)],
    );
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-047] Owner closes the Season and every Member sees final standings', async ({
    browser,
    request,
  }) => {
    const { first } = fixture();
    const memberCookie = await signedCookie(first.nonOwner.sessionToken);
    const memberContext = await browser.newContext({
      viewport: { width: 360, height: 900 },
      extraHTTPHeaders: { cookie: memberCookie },
    });
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/h/${first.houseId}/season`);
    await expect(memberPage.getByText('Season active', { exact: true })).toBeVisible();
    await expect(memberPage.getByRole('button', { name: 'Close Season' })).toHaveCount(0);

    const memberClose = await request.post(
      `/api/houses/${first.houseId}/seasons/${seasonId}/close`,
      { headers: { cookie: memberCookie, origin: 'http://127.0.0.1:3100' } },
    );
    expect(memberClose.status()).toBe(403);
    await expect(memberClose.json()).resolves.toMatchObject({ code: 'forbidden' });

    const ownerContext = await browser.newContext({
      viewport: { width: 360, height: 900 },
      extraHTTPHeaders: {
        cookie: await signedCookie(first.member.sessionToken),
        'x-request-id': 'bm-047-owner-e2e',
      },
    });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`/h/${first.houseId}/season`);
    await expect(ownerPage.getByRole('heading', { name: 'Close the Season' })).toBeVisible();
    await expectAccessibleNarrowLayout(ownerPage);

    await ownerPage.getByRole('button', { name: 'Close Season' }).click();
    const confirmation = ownerPage.getByRole('group', { name: 'Confirm Season close' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Close and finalize standings' }).click();

    await expect(ownerPage.getByText('Season closed · Final standings')).toBeVisible();
    await expect(ownerPage.getByRole('heading', { name: 'Autumn tables' })).toBeVisible();
    await expect(ownerPage.locator('.season-final__table li')).toHaveCount(3);
    await expect(ownerPage.getByRole('heading', { level: 1 })).toHaveText('Open a Season');
    await expectAccessibleNarrowLayout(ownerPage);

    await memberPage.reload();
    await expect(memberPage.getByText('Season closed · Final standings')).toBeVisible();
    await expect(memberPage.getByText('The table is waiting.')).toBeVisible();
    await expectAccessibleNarrowLayout(memberPage);

    const persisted = await database?.pool.query(
      `select s.state, s.closed_at is not null as closed,
              (select count(*)::int from season_final_standings f where f.season_id = s.id)
                as standings,
              (select count(*)::int from outbox_events e
                where e.aggregate_id = s.id and e.topic = 'season.closing') as closing_events
         from seasons s where s.id = $1`,
      [seasonId],
    );
    expect(persisted?.rows).toEqual([
      { state: 'closed', closed: true, standings: 3, closing_events: 1 },
    ]);

    await memberContext.close();
    await ownerContext.close();
  });
});
