import AxeBuilder from '@axe-core/playwright';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { expect, test } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const seasonId = '01941f29-7c00-7000-8000-000000000981';
const charterId = '01941f29-7c00-7000-8000-000000000982';
const nightIds = [
  '01941f29-7c00-7000-8000-000000000983',
  '01941f29-7c00-7000-8000-000000000984',
  '01941f29-7c00-7000-8000-000000000985',
  '01941f29-7c00-7000-8000-000000000986',
] as const;
const activeGameId = '01941f29-7c00-7000-8000-000000000987';
const completedGameId = '01941f29-7c00-7000-8000-000000000988';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('Night rail E2E fixture is not ready');
  return world;
}

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

async function expectNoBlockingAxeViolations(page: import('@playwright/test').Page): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(
    scan.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
}

async function seedRailNight(): Promise<void> {
  if (database === undefined) throw new Error('Night rail E2E database is not ready');
  await resetTwoHousesWithMembers(database.pool);
  world = await twoHousesWithMembers(database.pool);
  const seeded = fixture();
  const createdAt = new Date('2026-09-01T12:00:00.000Z');
  const startedAt = new Date('2026-09-04T14:00:00.000Z');
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
     values ($1, $2, 'Rail tables', 'draft', $3, $3)`,
    [seasonId, seeded.first.houseId, createdAt],
  );
  await database.pool.query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe, published_at, created_at)
     values ($1, $2, 1, 24, $3::jsonb, $4::jsonb, $5, $5)`,
    [
      charterId,
      seasonId,
      JSON.stringify({ weekday: 5, localTime: '19:30', count: 4 }),
      JSON.stringify({
        completedGame: 1,
        win: 2,
        draw: 1,
        nightAttendance: 1,
        publishedPuzzle: 1,
        caps: { games: 8, nights: 4, puzzles: 2 },
      }),
      createdAt,
    ],
  );
  await database.pool.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3,
            published_charter_version = 1, updated_at = $4
      where id = $1`,
    [
      seasonId,
      new Date('2026-09-04T00:00:00.000Z'),
      new Date('2026-10-02T00:00:00.000Z'),
      createdAt,
    ],
  );
  await database.pool.query(
    `insert into house_nights
      (id, house_id, season_id, scheduled_start, scheduled_end, state, started_at, created_at, updated_at)
     values ($1, $5, $6, '2026-09-04T14:00:00.000Z', '2026-09-04T16:00:00.000Z', 'live', $7, $7, $7),
            ($2, $5, $6, '2026-09-11T14:00:00.000Z', '2026-09-11T16:00:00.000Z', 'scheduled', null, $7, $7),
            ($3, $5, $6, '2026-09-18T14:00:00.000Z', '2026-09-18T16:00:00.000Z', 'scheduled', null, $7, $7),
            ($4, $5, $6, '2026-09-25T14:00:00.000Z', '2026-09-25T16:00:00.000Z', 'scheduled', null, $7, $7)`,
    [...nightIds, seeded.first.houseId, seasonId, startedAt],
  );
  await database.pool.query(
    `insert into games
      (id, house_id, season_id, night_id, mode, state, white_membership_id, black_membership_id,
       current_fen, current_ply, side_to_move, version, outbox_sequence, clock_policy,
       white_clock_ms, black_clock_ms, created_at)
     values ($1, $2, $3, $4, 'live', 'active', $5, $6,
             'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', 1, 'black', 1, 1,
             '{"kind":"live","initialMs":600000,"incrementMs":0}', 600000, 600000, $7)`,
    [
      activeGameId,
      seeded.first.houseId,
      seasonId,
      nightIds[0],
      seeded.first.member.membershipId,
      seeded.first.nonOwner.membershipId,
      createdAt,
    ],
  );
  await database.pool.query(
    `insert into games
      (id, house_id, season_id, night_id, mode, state, white_membership_id, black_membership_id,
       result, result_reason, outbox_sequence, clock_policy, white_clock_ms, black_clock_ms,
       created_at, completed_at)
     values ($1, $2, $3, $4, 'live', 'completed', $5, $6, 'white_win', 'resign', 2,
             '{"kind":"live","initialMs":600000,"incrementMs":0}', 1000, 1000, $7, $8)`,
    [
      completedGameId,
      seeded.first.houseId,
      seasonId,
      nightIds[0],
      seeded.first.member.membershipId,
      seeded.first.nonOwner.membershipId,
      createdAt,
      startedAt,
    ],
  );
  await database.pool.query(
    `insert into night_attendance
      (id, house_id, night_id, membership_id, first_joined_at, current_joined_at,
       accumulated_seconds, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $5, 0, $5, $5)`,
    [
      '01941f29-7c00-7000-8000-000000000989',
      seeded.first.houseId,
      nightIds[0],
      seeded.first.member.membershipId,
      startedAt,
    ],
  );
}

test.describe('Night rail', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for Night rail E2E');

  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl ?? '');
  });

  test.beforeEach(async () => {
    await seedRailNight();
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-038] renders durable board summaries at 360px before live attach', async ({ page }) => {
    const seeded = fixture();
    await page.setViewportSize({ width: 360, height: 900 });
    await page.setExtraHTTPHeaders({
      cookie: await signedCookie(seeded.first.member.sessionToken),
      'x-request-id': 'bm-038-rail-e2e',
    });

    await page.goto(`/h/${seeded.first.houseId}/nights/${nightIds[0]}`);
    await expect(page.getByRole('heading', { name: 'The rail' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Boards in play' })).toBeVisible();
    await expect(page.getByText('1 member at the table')).toBeVisible();
    await expect(page.getByText('Black to move')).toBeVisible();
    await expect(page.getByText('Ada won')).toBeVisible();
    await expectNoBlockingAxeViolations(page);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/presence')),
      page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))),
    ]);
  });

  test('[BM-039] updates presence count with server-signed member identity', async ({
    browser,
  }) => {
    const seeded = fixture();
    const memberContext = await browser.newContext({
      extraHTTPHeaders: {
        cookie: await signedCookie(seeded.first.member.sessionToken),
        'x-request-id': 'bm-039-member-presence',
      },
    });
    const guestContext = await browser.newContext({
      extraHTTPHeaders: {
        cookie: await signedCookie(seeded.first.nonOwner.sessionToken),
        'x-request-id': 'bm-039-guest-presence',
      },
    });
    const memberPage = await memberContext.newPage();
    const guestPage = await guestContext.newPage();
    const path = `/h/${seeded.first.houseId}/nights/${nightIds[0]}`;

    const memberPresenceResponse = memberPage.waitForResponse(
      (response) => response.url().endsWith('/presence') && response.request().method() === 'POST',
    );
    await memberPage.goto(path);
    const memberPresenceResponseResult = await memberPresenceResponse;
    const memberPresencePayload = await memberPresenceResponseResult.json();
    expect(memberPresenceResponseResult.status()).toBe(200);
    expect(memberPresencePayload).toMatchObject({
      presenceCount: 1,
      presence: [expect.objectContaining({ displayName: 'Ada' })],
    });
    await expect(memberPage.getByText('1 member at the table')).toBeVisible();
    const hereNow = memberPage.getByRole('region', { name: 'Here now' });
    await expect(hereNow.getByText('Ada', { exact: true })).toBeVisible();

    await guestPage.goto(path);
    await expect(memberPage.getByText('2 members at the table')).toBeVisible();
    await expect(
      memberPage.getByRole('region', { name: 'Here now' }).getByText('Bea', { exact: true }),
    ).toBeVisible();

    await Promise.all([
      guestPage.waitForResponse((response) => response.url().endsWith('/presence')),
      guestPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))),
    ]);
    await expect(memberPage.getByText('1 member at the table')).toBeVisible();

    await Promise.all([
      memberPage.waitForResponse((response) => response.url().endsWith('/presence')),
      memberPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))),
    ]);
    await guestContext.close();
    await memberContext.close();
  });
});
