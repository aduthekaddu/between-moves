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

function requiredDatabaseUrl(): string {
  if (testDatabaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
  return testDatabaseUrl;
}

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('House isolation fixture is not ready');
  return world;
}

async function signedCookie(token: string): Promise<string> {
  return `__Secure-between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
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
              ($4, $5, $6, '2099-01-01T00:00:00.000Z')`,
      [
        seeded.first.member.sessionId,
        seeded.first.member.userId,
        seeded.first.member.sessionToken,
        seeded.second.member.sessionId,
        seeded.second.member.userId,
        seeded.second.member.sessionToken,
      ],
    );
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
});
