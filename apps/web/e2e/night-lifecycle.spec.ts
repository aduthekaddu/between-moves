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
const seasonId = '01941f29-7c00-7000-8000-000000000971';
const charterId = '01941f29-7c00-7000-8000-000000000972';
const nightIds = [
  '01941f29-7c00-7000-8000-000000000973',
  '01941f29-7c00-7000-8000-000000000974',
  '01941f29-7c00-7000-8000-000000000975',
  '01941f29-7c00-7000-8000-000000000976',
] as const;
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('Night lifecycle E2E fixture is not ready');
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

async function seedScheduledNights(): Promise<void> {
  if (database === undefined) throw new Error('Night lifecycle E2E database is not ready');
  await resetTwoHousesWithMembers(database.pool);
  world = await twoHousesWithMembers(database.pool);
  const seeded = fixture();
  const createdAt = new Date('2026-09-01T12:00:00.000Z');
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
    `insert into seasons
      (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Autumn tables', 'draft', $3, $3)`,
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
      (id, house_id, season_id, scheduled_start, scheduled_end, state, created_at, updated_at)
     values ($1, $5, $6, '2026-09-04T14:00:00.000Z', '2026-09-04T16:00:00.000Z', 'scheduled', $7, $7),
            ($2, $5, $6, '2026-09-11T14:00:00.000Z', '2026-09-11T16:00:00.000Z', 'scheduled', $7, $7),
            ($3, $5, $6, '2026-09-18T14:00:00.000Z', '2026-09-18T16:00:00.000Z', 'scheduled', $7, $7),
            ($4, $5, $6, '2026-09-25T14:00:00.000Z', '2026-09-25T16:00:00.000Z', 'scheduled', $7, $7)`,
    [...nightIds, seeded.first.houseId, seasonId, createdAt],
  );
}

test.describe('Night lifecycle', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for Night lifecycle E2E');

  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl ?? '');
  });

  test.beforeEach(async () => {
    await seedScheduledNights();
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-035] host starts and ends an accessible Night', async ({ page, request }) => {
    const seeded = fixture();
    const ownerCookie = await signedCookie(seeded.first.member.sessionToken);
    const hostCookie = await signedCookie(seeded.first.nonOwner.sessionToken);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.setExtraHTTPHeaders({ cookie: ownerCookie, 'x-request-id': 'bm-035-owner-e2e' });

    await page.goto(`/h/${seeded.first.houseId}/season`);
    const firstNight = page.locator('.night-card').nth(0);
    await firstNight.getByText('Manage Night 1').click();
    await firstNight.getByLabel('Night host for Night 1').selectOption({ label: 'Bea' });
    await firstNight.getByRole('button', { name: 'Assign Night host' }).click();
    await expectNoBlockingAxeViolations(page);

    await page.setExtraHTTPHeaders({ cookie: hostCookie, 'x-request-id': 'bm-035-host-e2e' });
    await page.reload();
    const hostedNight = page.locator('.night-card').nth(0);
    await hostedNight.getByRole('button', { name: 'Start Night 1' }).click();
    await expect(hostedNight.getByText('Asia/Kolkata · Live')).toBeVisible();
    await hostedNight.getByRole('button', { name: 'End Night 1' }).click();
    await expect(hostedNight.getByText('Asia/Kolkata · Ended')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Night 2' })).toHaveCount(0);
    await expectNoBlockingAxeViolations(page);

    const denied = await request.post(
      `/api/houses/${seeded.first.houseId}/nights/${nightIds[1]}/start`,
      { headers: { cookie: hostCookie, origin: 'http://127.0.0.1:3100' } },
    );
    expect(denied.status()).toBe(403);

    const persisted = await database?.pool.query(
      `select state, host_membership_id::text as host, started_at is not null as started,
              ended_at is not null as ended
         from house_nights where id = $1`,
      [nightIds[0]],
    );
    expect(persisted?.rows).toEqual([
      {
        state: 'ended',
        host: seeded.first.nonOwner.membershipId,
        started: true,
        ended: true,
      },
    ]);
  });
});
