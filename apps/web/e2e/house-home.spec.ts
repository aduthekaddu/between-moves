import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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
const shelfSeasonId = '01941f29-7c00-7000-8000-000000000741';

function shelfGameId(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function requiredDatabaseUrl(): string {
  if (testDatabaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
  return testDatabaseUrl;
}

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('House isolation fixture is not ready');
  return world;
}

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

async function openMemberHome(page: Page, seeded: TwoHousesWithMembers, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.setExtraHTTPHeaders({
    cookie: await signedCookie(seeded.first.member.sessionToken),
    'x-request-id': `bm-013-member-${width}-e2e`,
  });

  return page.goto(`/h/${seeded.first.houseId}`);
}

async function expectNoBlockingAxeViolations(page: Page): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(
    scan.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
}

async function seedMoveShelf(db: Database, seeded: TwoHousesWithMembers): Promise<void> {
  await db.pool.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Shelf season', 'draft', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    [shelfSeasonId, seeded.first.houseId],
  );
  const games = [
    [
      751,
      seeded.first.member.membershipId,
      seeded.first.nonOwner.membershipId,
      'active',
      'white',
      null,
      '2020-09-08T09:00:00.000Z',
      null,
    ],
    [
      752,
      seeded.first.member.membershipId,
      seeded.switchingMember.firstMembershipId,
      'active',
      'white',
      null,
      '2026-09-10T09:00:00.000Z',
      null,
    ],
    [
      753,
      seeded.first.member.membershipId,
      seeded.first.nonOwner.membershipId,
      'active',
      'black',
      null,
      '2026-09-09T09:00:00.000Z',
      null,
    ],
    [
      754,
      seeded.switchingMember.firstMembershipId,
      seeded.first.member.membershipId,
      'active',
      'white',
      null,
      '2026-09-12T09:00:00.000Z',
      null,
    ],
    [
      755,
      seeded.first.member.membershipId,
      seeded.first.nonOwner.membershipId,
      'completed',
      'black',
      'draw',
      null,
      '2026-09-06T09:00:00.000Z',
    ],
    [
      756,
      seeded.switchingMember.firstMembershipId,
      seeded.first.member.membershipId,
      'completed',
      'white',
      'black_win',
      null,
      '2026-09-02T09:00:00.000Z',
    ],
  ] as const;

  for (const [suffix, whiteId, blackId, state, sideToMove, result, dueAt, completedAt] of games) {
    await db.pool.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         side_to_move, result, result_reason, clock_policy, move_due_at, completed_at, created_at)
       values ($1, $2, $3, 'correspondence', $4, $5, $6, $7, $8,
               case when $4 = 'completed' then 'agreement' else null end,
               '{"kind":"correspondence","perMoveHours":48}', $9, $10,
               '2026-09-01T00:00:00.000Z')`,
      [
        shelfGameId(suffix),
        seeded.first.houseId,
        shelfSeasonId,
        state,
        whiteId,
        blackId,
        sideToMove,
        result,
        dueAt,
        completedAt,
      ],
    );
  }
}

test.describe('member-scoped House home', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for House E2E');

  test.beforeAll(async () => {
    database = createDatabase(requiredDatabaseUrl());
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
        seeded.second.member.sessionId,
        seeded.second.member.userId,
        seeded.second.member.sessionToken,
        seeded.switchingMember.sessionId,
        seeded.switchingMember.userId,
        seeded.switchingMember.sessionToken,
      ],
    );
    await seedMoveShelf(database, seeded);
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  for (const width of [320, 360, 768] as const) {
    test(`[BM-013] [UX-A11Y-01] [UX-RESP-07] Member sees an accessible House home at ${width} px`, async ({
      page,
    }) => {
      const seeded = fixture();
      const response = await openMemberHome(page, seeded, width);

      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(seeded.first.name);
      await expect(page.getByText(seeded.first.description)).toBeVisible();
      await expect(page.getByRole('img', { name: `${seeded.first.name} emblem` })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex.*nofollow/,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expectNoBlockingAxeViolations(page);
    });
  }

  test('[BM-013] [UX-A11Y-11] keeps the House home usable at 200% zoom', async ({ page }) => {
    const seeded = fixture();
    await openMemberHome(page, seeded, 640);

    await page.evaluate(() => document.documentElement.style.setProperty('zoom', '2'));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(seeded.first.name);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('[BM-026] [DR-SHELF-01] orders an accessible Move Shelf at 360 px', async ({ page }) => {
    const seeded = fixture();
    await openMemberHome(page, seeded, 360);

    await expect(page.getByRole('heading', { name: 'Your move (2)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Waiting (2)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recently completed (2)' })).toBeVisible();
    await expect(page.getByText('Move overdue', { exact: true }).first()).toBeVisible();
    await expect(
      page.locator('[data-shelf-group="your-move"] [data-game-id]').first(),
    ).toHaveAttribute('data-game-id', shelfGameId(751));
    await expect(
      page.locator('[data-shelf-group="waiting"] [data-game-id]').first(),
    ).toHaveAttribute('data-game-id', shelfGameId(753));
    await expect(
      page.locator('[data-shelf-group="recent"] [data-game-id]').first(),
    ).toHaveAttribute('data-game-id', shelfGameId(755));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expectNoBlockingAxeViolations(page);
  });

  test('[BM-013] [PR-PLAT-05] non-Member receives 404 without other-House content', async ({
    page,
  }) => {
    const seeded = fixture();
    await page.setExtraHTTPHeaders({
      cookie: await signedCookie(seeded.first.member.sessionToken),
      'x-request-id': 'bm-013-cross-house-e2e',
    });

    const response = await page.goto(`/h/${seeded.second.houseId}`);

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'This House is not available.',
    );
    await expect(page.getByText(seeded.second.name)).toHaveCount(0);
  });

  test('[BM-017] one session switches Houses without mixing data or capabilities', async ({
    page,
  }) => {
    const seeded = fixture();
    await page.setExtraHTTPHeaders({
      cookie: await signedCookie(seeded.switchingMember.sessionToken),
      'x-request-id': 'bm-017-multi-house-switch-e2e',
    });

    const firstResponse = await page.goto(`/h/${seeded.first.houseId}`);
    expect(firstResponse?.status()).toBe(200);
    expect(firstResponse?.headers()['cache-control']).toContain('no-store');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(seeded.first.name);
    await expect(page.getByText('Steward', { exact: true })).toBeVisible();
    await expect(page.getByText(seeded.second.name)).toHaveCount(0);

    const secondResponse = await page.goto(`/h/${seeded.second.houseId}`);
    expect(secondResponse?.status()).toBe(200);
    expect(secondResponse?.headers()['cache-control']).toContain('no-store');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(seeded.second.name);
    await expect(page.getByText('Member', { exact: true })).toBeVisible();
    await expect(page.getByText(seeded.first.name)).toHaveCount(0);
    await expect(page.getByText('Steward', { exact: true })).toHaveCount(0);
  });
});
