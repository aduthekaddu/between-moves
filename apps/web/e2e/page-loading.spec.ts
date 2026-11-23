import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { expect, test } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { unusedPreloads } from './support/unused-preloads';

/**
 * A page must not fetch what it does not show. Next.js serialises the root not-found page
 * into every route's payload, so an image there that React preloads costs every page a
 * request at high priority (the 404 photo did, on slow phones). These checks run on
 * ordinary routes, where nothing may fail to load and every preload must have a user.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'e2e-better-auth-secret-at-least-32-characters';
let database: Database;
let world: TwoHousesWithMembers;

test.describe('page loading', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required');
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    await resetTwoHousesWithMembers(database.pool);
    world = await twoHousesWithMembers(database.pool);
    await database.pool.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, '2099-01-01T00:00:00.000Z')`,
      [world.first.member.sessionId, world.first.member.userId, world.first.member.sessionToken],
    );
  });
  test.afterAll(async () => {
    if (!database) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  for (const route of ['/', '/sign-in', 'house home'] as const) {
    test(`${route}: no failed request and no preload without a user`, async ({ page }) => {
      const failed: string[] = [];
      const warnings: string[] = [];
      page.on('response', (response) => {
        if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
      });
      page.on('console', (message) => {
        if (/preloaded using link preload but not used/.test(message.text())) {
          warnings.push(message.text());
        }
      });
      let path = route as string;
      if (route === 'house home') {
        const token = world.first.member.sessionToken;
        await page.setExtraHTTPHeaders({
          cookie: `between-moves.session_token=${token}.${await makeSignature(token, secret)}`,
        });
        path = `/h/${world.first.houseId}`;
      }
      const response = await page.goto(path, { waitUntil: 'load' });
      expect(response?.status()).toBe(200);

      const unused = await unusedPreloads(page);
      expect(unused, `${path} declares preloads that nothing on the page uses`).toEqual([]);

      // Chrome reports a preload that went unused a few seconds after load.
      await page.waitForTimeout(3_500);
      expect(warnings, `${path} preloaded a resource it did not use`).toEqual([]);
      expect(failed, `${path} had failed requests`).toEqual([]);
    });
  }
});
