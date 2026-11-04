import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { makeSignature } from 'better-auth/crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'e2e-better-auth-secret-at-least-32-characters';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('Charter E2E fixture is not ready');
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

test.describe('Charter authoring and publication', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for Charter E2E');

  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl ?? '');
    await resetTwoHousesWithMembers(database.pool);
    world = await twoHousesWithMembers(database.pool);
    const seeded = fixture();
    await database.pool.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, '2099-01-01T00:00:00.000Z'),
              ($4, $5, $6, '2099-01-01T00:00:00.000Z'),
              ($7, $8, $9, '2099-01-01T00:00:00.000Z')`,
      [
        seeded.first.member.sessionId,
        seeded.first.member.userId,
        seeded.first.member.sessionToken,
        seeded.first.nonOwner.sessionId,
        seeded.first.nonOwner.userId,
        seeded.first.nonOwner.sessionToken,
        seeded.second.nonOwner.sessionId,
        seeded.second.nonOwner.userId,
        seeded.second.nonOwner.sessionToken,
      ],
    );
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-019] Owner publishes an accessible Charter and sees the active Season', async ({
    page,
    request,
  }) => {
    const seeded = fixture();
    const ownerCookie = await signedCookie(seeded.first.member.sessionToken);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.setExtraHTTPHeaders({ cookie: ownerCookie, 'x-request-id': 'bm-019-owner-e2e' });

    await page.goto(`/h/${seeded.first.houseId}`);
    await page.getByRole('link', { name: 'Open the Season table' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open a Season');
    await expect(page.getByLabel('Season title')).toHaveValue(/^[A-Z][a-z]+ Season$/);
    await expectNoBlockingAxeViolations(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await page.getByLabel('Season title').fill('Autumn tables');
    await page.getByLabel('Season starts').fill('2026-09-04');
    await expect(page.getByText('2 October 2026', { exact: true })).toBeVisible();
    await page.getByLabel('Correspondence pace').fill('24');
    await page.getByLabel('Weekday').selectOption('5');
    await page.getByLabel('Local time').fill('19:30');
    await page.getByRole('button', { name: 'Open the Season' }).click();

    await expect(page.getByText('Season active', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Autumn tables');
    await expect(page.getByText('Charter version 1', { exact: true })).toBeVisible();
    await expectNoBlockingAxeViolations(page);

    await page.reload();
    await expect(page.getByText('Season active', { exact: true })).toBeVisible();
    await expect(page.getByText('Charter version 1', { exact: true })).toBeVisible();

    const firstNight = page.locator('.night-card').nth(0);
    await firstNight.getByLabel('New start for Night 1 (Asia/Kolkata)').fill('2026-09-05T19:30');
    await firstNight.getByLabel('New end for Night 1 (Asia/Kolkata)').fill('2026-09-05T21:30');
    await firstNight.getByRole('button', { name: 'Reschedule' }).click();
    await expect(firstNight.getByText('5 Sept 2026, 19:30', { exact: false })).toBeVisible();

    const secondNight = page.locator('.night-card').nth(1);
    await secondNight.getByRole('button', { name: 'Cancel Night' }).click();
    const cancellation = secondNight.getByRole('group', {
      name: 'Confirm cancellation for Night 2',
    });
    await expect(cancellation).toBeVisible();
    await cancellation.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(secondNight.getByText('Asia/Kolkata · Cancelled')).toBeVisible();
    await expectNoBlockingAxeViolations(page);

    await page.reload();
    await expect(page.getByText('Season active', { exact: true })).toBeVisible();
    await expect(page.getByText('Charter version 1', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Scheduled Between Moves Nights' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Night [1-4]$/ })).toHaveCount(4);
    await expect(page.getByText('Asia/Kolkata · Scheduled')).toHaveCount(3);
    await expectNoBlockingAxeViolations(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    const persisted = await database?.pool.query(
      `select s.id, s.state, s.published_charter_version,
              c.correspondence_pace_hours, c.night_recurrence, c.points_recipe
         from seasons s
         join season_charters c
           on c.season_id = s.id and c.version = s.published_charter_version
        where s.house_id = $1`,
      [seeded.first.houseId],
    );
    expect(persisted?.rows).toEqual([
      expect.objectContaining({
        state: 'active',
        published_charter_version: 1,
        correspondence_pace_hours: 24,
        night_recurrence: { weekday: 5, localTime: '19:30', count: 4 },
        points_recipe: {
          completedGame: 1,
          win: 2,
          draw: 1,
          nightAttendance: 1,
          publishedPuzzle: 1,
          caps: { games: 8, nights: 4, puzzles: 2 },
        },
      }),
    ]);
    const seasonId = String(persisted?.rows[0]?.id);
    const scheduledNights = await database?.pool.query(
      `select scheduled_start, scheduled_end, state
         from house_nights where house_id = $1 order by scheduled_start`,
      [seeded.first.houseId],
    );
    expect(scheduledNights?.rows).toEqual([
      expect.objectContaining({
        scheduled_start: new Date('2026-09-05T14:00:00.000Z'),
        state: 'scheduled',
      }),
      expect.objectContaining({
        scheduled_start: new Date('2026-09-11T14:00:00.000Z'),
        state: 'cancelled',
      }),
      expect.objectContaining({
        scheduled_start: new Date('2026-09-18T14:00:00.000Z'),
        state: 'scheduled',
      }),
      expect.objectContaining({
        scheduled_start: new Date('2026-09-25T14:00:00.000Z'),
        state: 'scheduled',
      }),
    ]);
    const nightAudit = await database?.pool.query(
      `select action, actor_membership_id
         from night_audit where house_id = $1 order by created_at, id`,
      [seeded.first.houseId],
    );
    expect(nightAudit?.rows).toEqual([
      { action: 'rescheduled', actor_membership_id: seeded.first.member.membershipId },
      { action: 'cancelled', actor_membership_id: seeded.first.member.membershipId },
    ]);

    const invalid = await request.post(
      `/api/houses/${seeded.first.houseId}/seasons/${seasonId}/charter`,
      {
        headers: { cookie: ownerCookie, origin: 'http://127.0.0.1:3100' },
        data: {
          correspondencePaceHours: 0,
          nightRecurrence: { weekday: 8, localTime: '25:00', count: 3 },
        },
      },
    );
    expect(invalid.status()).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      errors: {
        correspondencePaceHours: expect.any(Array),
        'nightRecurrence.weekday': expect.any(Array),
        'nightRecurrence.localTime': expect.any(Array),
      },
    });

    const memberPublish = await request.post(
      `/api/houses/${seeded.first.houseId}/seasons/${seasonId}/publish`,
      {
        headers: {
          cookie: await signedCookie(seeded.first.nonOwner.sessionToken),
          origin: 'http://127.0.0.1:3100',
        },
        data: {
          title: 'Changed by a Member',
          startsAt: '2026-09-04T00:00:00.000Z',
          endsAt: '2026-10-02T00:00:00.000Z',
        },
      },
    );
    expect(memberPublish.status()).toBe(403);
    await expect(memberPublish.json()).resolves.toMatchObject({ code: 'forbidden' });
  });

  test('[BM-019] Member passive Season state is accessible at 360px', async ({ page }) => {
    const seeded = fixture();
    await page.setViewportSize({ width: 360, height: 900 });
    await page.setExtraHTTPHeaders({
      cookie: await signedCookie(seeded.second.nonOwner.sessionToken),
      'x-request-id': 'bm-019-member-passive-e2e',
    });

    await page.goto(`/h/${seeded.second.houseId}/season`);
    await expect(
      page.getByText(
        'No Season is running yet. When an Owner or Steward opens one, games and points start.',
      ),
    ).toBeVisible();
    await expectNoBlockingAxeViolations(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
