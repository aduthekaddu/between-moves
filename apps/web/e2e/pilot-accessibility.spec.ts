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
const correspondenceId = '01941f29-7c00-7000-8000-000000000972';
const liveId = '01941f29-7c00-7000-8000-000000000973';
let database: Database;
let world: TwoHousesWithMembers;

test.describe('[BM-052] pilot core page accessibility', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required');
  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
  });
  test.beforeEach(async () => {
    await resetTwoHousesWithMembers(database.pool);
    world = await twoHousesWithMembers(database.pool);
    await database.pool.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, '2099-01-01T00:00:00.000Z')`,
      [world.first.member.sessionId, world.first.member.userId, world.first.member.sessionToken],
    );
    await database.pool.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Pilot season', 'draft', now(), now())`,
      [seasonId, world.first.houseId],
    );
    await database.pool.query(
      `insert into games (id, house_id, season_id, mode, state,
         white_membership_id, black_membership_id, clock_policy, move_due_at)
       values ($1, $2, $3, 'correspondence', 'active', $4, $5,
         '{"kind":"correspondence","perMoveHours":48}', now() + interval '48 hours')`,
      [
        correspondenceId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
      ],
    );
    await database.pool.query(
      `insert into games (id, house_id, season_id, mode, state,
         white_membership_id, black_membership_id, clock_policy,
         white_clock_ms, black_clock_ms, turn_started_at)
       values ($1, $2, $3, 'live', 'active', $4, $5,
         '{"kind":"live","initialMs":300000,"incrementMs":2000}',
         300000, 300000, now())`,
      [
        liveId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
      ],
    );
  });
  test.afterAll(async () => {
    if (!database) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  for (const width of [360, 768] as const) {
    test(`axe, keyboard, overflow and navigation budget at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const token = world.first.member.sessionToken;
      await page.setExtraHTTPHeaders({
        cookie: `between-moves.session_token=${token}.${await makeSignature(token, secret)}`,
      });
      const paths = [
        '/account',
        `/h/${world.first.houseId}`,
        `/h/${world.first.houseId}/season`,
        `/h/${world.first.houseId}/games/${correspondenceId}`,
        `/h/${world.first.houseId}/games/${liveId}/live`,
      ];
      const surfaces = ['account', 'house', 'season', 'correspondence', 'live'] as const;
      for (const [index, path] of paths.entries()) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(200);
        await page.evaluate(() => document.fonts.ready);
        const scan = await new AxeBuilder({ page }).analyze();
        expect(
          scan.violations.filter(
            (violation) => violation.impact === 'critical' || violation.impact === 'serious',
          ),
          path,
        ).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          path,
        ).toBe(true);
        const navigationMs = await page.evaluate(
          () =>
            (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)
              ?.responseEnd ?? Infinity,
        );
        await testInfo.attach(`pilot-a11y-${width}-${index}.json`, {
          body: Buffer.from(
            JSON.stringify(
              {
                path,
                width,
                navigation_response_ms: navigationMs,
                violations: scan.violations.map(({ id, impact, nodes }) => ({
                  id,
                  impact,
                  affected_nodes: nodes.length,
                })),
              },
              null,
              2,
            ),
          ),
          contentType: 'application/json',
        });
        expect(navigationMs, `${path} navigation response budget`).toBeLessThan(5_000);
        const surface = surfaces[index];
        if (surface === 'account' || surface === 'house' || surface === 'season') {
          await expect(page).toHaveScreenshot(`pilot-page-${width}-${surface}.png`, {
            animations: 'disabled',
            maxDiffPixelRatio: 0.02,
          });
        }
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement !== document.body), path).toBe(
          true,
        );
        if (path.endsWith(correspondenceId) || path.endsWith('/live')) {
          const board = page.getByRole('grid', { name: /Chessboard/ });
          await expect(board).toBeVisible();
          await expect(board).toHaveScreenshot(
            `pilot-board-${width}-${path.endsWith('/live') ? 'live' : 'correspondence'}.png`,
            { animations: 'disabled', maxDiffPixelRatio: 0.02 },
          );
        }
      }
    });
  }
});
