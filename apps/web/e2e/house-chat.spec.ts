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
const seasonId = '01941f29-7c00-7000-8000-000000000991';
const charterId = '01941f29-7c00-7000-8000-000000000993';
const nightId = '01941f29-7c00-7000-8000-000000000992';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('House chat E2E fixture is not ready');
  return world;
}

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

async function seedLiveNight(): Promise<void> {
  if (database === undefined) throw new Error('House chat E2E database is not ready');
  await resetTwoHousesWithMembers(database.pool);
  world = await twoHousesWithMembers(database.pool);
  const seeded = fixture();
  const startedAt = new Date('2026-09-18T14:00:00.000Z');
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
     values ($1, $2, 'Chat season', 'draft', $3, $3)`,
    [seasonId, seeded.first.houseId, startedAt],
  );
  await database.pool.query(
    `insert into season_charters
      (id, season_id, version, correspondence_pace_hours, night_recurrence, points_recipe, published_at, created_at)
     values ($1, $2, 1, 24, $3::jsonb, $4::jsonb, $5, $5)`,
    [
      charterId,
      seasonId,
      JSON.stringify({ weekday: 5, localTime: '19:30', count: 1 }),
      JSON.stringify({
        completedGame: 1,
        win: 2,
        draw: 1,
        nightAttendance: 1,
        publishedPuzzle: 1,
        caps: { games: 8, nights: 1, puzzles: 2 },
      }),
      startedAt,
    ],
  );
  await database.pool.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3,
            published_charter_version = 1, updated_at = $4
      where id = $1`,
    [
      seasonId,
      new Date('2026-09-18T00:00:00.000Z'),
      new Date('2026-09-25T00:00:00.000Z'),
      startedAt,
    ],
  );
  await database.pool.query(
    `insert into house_nights
      (id, house_id, season_id, scheduled_start, scheduled_end, state, started_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'live', $6, $6, $6)`,
    [
      nightId,
      seeded.first.houseId,
      seasonId,
      new Date('2026-09-18T14:00:00.000Z'),
      new Date('2026-09-18T16:00:00.000Z'),
      startedAt,
    ],
  );
}

test.describe('House chat', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for House chat E2E');

  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl ?? '');
  });

  test.beforeEach(async () => {
    await seedLiveNight();
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-040] sends, reconnects without a gap, escapes HTML, and soft-deletes', async ({
    page,
  }) => {
    const seeded = fixture();
    const hostile = '<script>window.chatOwned=true</script><b>Hello from the rail</b>';
    const path = `/h/${seeded.first.houseId}/nights/${nightId}`;
    await page.setViewportSize({ width: 360, height: 900 });
    await page.setExtraHTTPHeaders({
      cookie: await signedCookie(seeded.first.nonOwner.sessionToken),
      'x-request-id': 'bm-040-chat-e2e',
    });
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { name: 'House chat' })).toBeVisible();
    await page.getByLabel('Your message').fill(hostile);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Your message was sent.')).toBeVisible();
    const messages = page.getByLabel('House chat messages');
    await expect(messages.getByText(hostile, { exact: true })).toBeVisible();
    await expect(page.locator('.house-chat__message script')).toHaveCount(0);
    await expect(page.locator('.house-chat__message b')).toHaveCount(0);
    await expect(
      page.evaluate(() => (window as unknown as { chatOwned?: boolean }).chatOwned),
    ).resolves.toBeUndefined();
    await expect(
      database?.pool.query(
        'select body, deleted_at from house_messages where night_id=$1 and membership_id=$2',
        [nightId, seeded.first.nonOwner.membershipId],
      ),
    ).resolves.toMatchObject({
      rowCount: 1,
      rows: [{ body: hostile, deleted_at: null }],
    });

    await page.reload();
    await expect(
      page.getByLabel('House chat messages').getByText(hostile, { exact: true }),
    ).toBeVisible();

    await page.setExtraHTTPHeaders({
      cookie: await signedCookie(seeded.first.member.sessionToken),
      'x-request-id': 'bm-040-chat-moderate-e2e',
    });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Remove message from Bea' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove message from Bea' }).click();
    await expect(page.getByText('The message was removed.')).toBeVisible();
    await expect(page.getByLabel('House chat messages').getByText(hostile)).toHaveCount(0);
    await expect(
      database?.pool.query(
        'select deleted_at from house_messages where night_id=$1 and membership_id=$2',
        [nightId, seeded.first.nonOwner.membershipId],
      ),
    ).resolves.toMatchObject({
      rowCount: 1,
      rows: [{ deleted_at: expect.any(Date) }],
    });

    await page.reload();
    await expect(page.getByText('No messages yet.')).toBeVisible();
    const scan = await new AxeBuilder({ page }).analyze();
    expect(
      scan.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      ),
    ).toEqual([]);
  });
});
