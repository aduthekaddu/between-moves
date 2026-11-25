import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { expect, test, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { auditTouch } from './support/touch-audit';

/**
 * Phone and touch regressions that CSS rules cannot see: the size text computes to,
 * the area a finger can hit, controls that overlap, and text that runs under a control.
 * Each width is a phone: 320 (the WCAG 1.4.10 reflow width) and 360 (the pilot width).
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const seasonId = '01941f29-7c00-7000-8000-000000000981';
const charterId = '01941f29-7c00-7000-8000-000000000982';
const liveNightId = '01941f29-7c00-7000-8000-000000000983';
const scheduledNightId = '01941f29-7c00-7000-8000-000000000984';
const correspondenceId = '01941f29-7c00-7000-8000-000000000985';
const liveGameId = '01941f29-7c00-7000-8000-000000000986';
const messageIds = [
  '01941f29-7c00-7000-8000-000000000987',
  '01941f29-7c00-7000-8000-000000000988',
] as const;
// One name that packs a line up to the Remove button, one with no break point at all.
const spacedName = 'Maximilian Alexander Montgomery Smith';
const unbrokenName = 'Wolfeschlegelsteinhausenbergerdorff';
let database: Database;
let world: TwoHousesWithMembers;

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

async function seed(): Promise<void> {
  await resetTwoHousesWithMembers(database.pool);
  world = await twoHousesWithMembers(database.pool);
  const { first } = world;
  const at = new Date('2026-09-18T14:00:00.000Z');
  await database.pool.query(
    `insert into sessions (id, user_id, token, expires_at)
     values ($1, $2, $3, '2099-01-01T00:00:00.000Z')`,
    [first.member.sessionId, first.member.userId, first.member.sessionToken],
  );
  await database.pool.query('update users set display_name = $2 where id = $1', [
    first.nonOwner.userId,
    spacedName,
  ]);
  await database.pool.query('update users set display_name = $2 where id = $1', [
    first.member.userId,
    unbrokenName,
  ]);
  await database.pool.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Phone season', 'draft', $3, $3)`,
    [seasonId, first.houseId, at],
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
      at,
    ],
  );
  await database.pool.query(
    `update seasons
        set state = 'active', starts_at = $2, ends_at = $3,
            published_charter_version = 1, updated_at = $4
      where id = $1`,
    [seasonId, new Date('2026-09-04T00:00:00.000Z'), new Date('2026-10-02T00:00:00.000Z'), at],
  );
  await database.pool.query(
    `insert into house_nights
      (id, house_id, season_id, scheduled_start, scheduled_end, state, started_at,
       chat_sequence, created_at, updated_at)
     values ($1, $3, $4, $5, $6, 'live', $5, 2, $5, $5),
            ($2, $3, $4, $7, $8, 'scheduled', null, 0, $5, $5)`,
    [
      liveNightId,
      scheduledNightId,
      first.houseId,
      seasonId,
      at,
      new Date('2026-09-18T16:00:00.000Z'),
      new Date('2026-09-25T14:00:00.000Z'),
      new Date('2026-09-25T16:00:00.000Z'),
    ],
  );
  await database.pool.query(
    `insert into house_messages (id, house_id, night_id, membership_id, body, sequence, created_at)
     values ($1, $3, $4, $5, 'Good evening, everyone.', 1, $7),
            ($2, $3, $4, $6, 'Good evening to you too.', 2, $7)`,
    [
      messageIds[0],
      messageIds[1],
      first.houseId,
      liveNightId,
      first.nonOwner.membershipId,
      first.member.membershipId,
      at,
    ],
  );
  await database.pool.query(
    `insert into games (id, house_id, season_id, mode, state,
       white_membership_id, black_membership_id, clock_policy, move_due_at)
     values ($1, $2, $3, 'correspondence', 'active', $4, $5,
       '{"kind":"correspondence","perMoveHours":48}', now() + interval '48 hours')`,
    [
      correspondenceId,
      first.houseId,
      seasonId,
      first.member.membershipId,
      first.nonOwner.membershipId,
    ],
  );
  await database.pool.query(
    `insert into games (id, house_id, season_id, mode, state,
       white_membership_id, black_membership_id, clock_policy,
       white_clock_ms, black_clock_ms, turn_started_at)
     values ($1, $2, $3, 'live', 'active', $4, $5,
       '{"kind":"live","initialMs":300000,"incrementMs":2000}', 300000, 300000, now())`,
    [liveGameId, first.houseId, seasonId, first.member.membershipId, first.nonOwner.membershipId],
  );
}

async function expectNoSidewaysScroll(page: Page, route: string): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${route} scrolls sideways`,
  ).toBe(true);
}

const phones = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
] as const;

test.describe('phone and touch guards', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required');
  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    await seed();
  });
  test.afterAll(async () => {
    if (!database) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  for (const viewport of phones) {
    test.describe(`${viewport.width}px touch screen`, () => {
      test.use({ viewport, hasTouch: true, isMobile: true });

      test('signed-out pages: 16px fields, 24px targets, no overlap', async ({
        page,
      }, testInfo) => {
        const seen = new Set<string>();
        const problems: string[] = [];
        for (const route of ['/', '/sign-in', '/sign-up', '/recover', '/no-such-page']) {
          const response = await page.goto(route);
          expect(response?.status(), route).toBe(route === '/no-such-page' ? 404 : 200);
          const audit = await auditTouch(page);
          for (const name of audit.targets) seen.add(name);
          problems.push(...audit.problems.map((problem) => `${route}: ${problem}`));
          await expectNoSidewaysScroll(page, route);
          await testInfo.attach(`touch-${viewport.width}-${route.replaceAll('/', '_')}.json`, {
            body: Buffer.from(JSON.stringify(audit, null, 2)),
            contentType: 'application/json',
          });
        }
        expect(problems).toEqual([]);
        // The audit must have looked at the controls this class of bug lives in.
        expect([...seen].some((name) => name.includes('.auth-masthead__back'))).toBe(true);
        expect([...seen].some((name) => name.includes('.lp-sound'))).toBe(true);
      });

      test('signed-in pages: 16px fields, 24px targets, no overlap', async ({ page }, testInfo) => {
        const { first } = world;
        await page.setExtraHTTPHeaders({ cookie: await signedCookie(first.member.sessionToken) });
        const house = `/h/${first.houseId}`;
        const seen = new Set<string>();
        const fields = new Set<string>();
        const problems: string[] = [];
        for (const route of [
          '/account',
          house,
          `${house}/season`,
          `${house}/games/${correspondenceId}`,
          `${house}/games/${liveGameId}/live`,
          `${house}/nights/${liveNightId}`,
        ]) {
          const response = await page.goto(route);
          expect(response?.status(), route).toBe(200);
          const audit = await auditTouch(page);
          for (const name of audit.targets) seen.add(name);
          for (const name of audit.fields) fields.add(name);
          problems.push(...audit.problems.map((problem) => `${route}: ${problem}`));
          await expectNoSidewaysScroll(page, route);
          await testInfo.attach(`touch-${viewport.width}-${route.replaceAll('/', '_')}.json`, {
            body: Buffer.from(JSON.stringify(audit, null, 2)),
            contentType: 'application/json',
          });
        }
        expect(problems).toEqual([]);
        expect([...seen].some((name) => name.includes('Manage Night'))).toBe(true);
        expect([...seen].some((name) => name.includes('.house-chat__remove'))).toBe(true);
        expect([...fields].some((name) => name.includes('select'))).toBe(true);
      });

      test('the landing caption stays clear of the Sound button', async ({ page }) => {
        await page.goto('/');
        const caption = page.locator('.lp-caption');
        const sound = page.locator('.lp-sound');
        await expect(caption).toBeVisible();
        await expect(sound).toBeVisible();
        // The caption advances on a timer, so measure it on several frames.
        for (let frame = 0; frame < 4; frame += 1) {
          const [captionBox, soundBox] = await Promise.all([
            caption.boundingBox(),
            sound.boundingBox(),
          ]);
          expect(captionBox).not.toBeNull();
          expect(soundBox).not.toBeNull();
          const overlapX =
            Math.min(captionBox!.x + captionBox!.width, soundBox!.x + soundBox!.width) -
            Math.max(captionBox!.x, soundBox!.x);
          const overlapY =
            Math.min(captionBox!.y + captionBox!.height, soundBox!.y + soundBox!.height) -
            Math.max(captionBox!.y, soundBox!.y);
          expect(
            overlapX > 0 && overlapY > 0,
            `caption ${JSON.stringify(captionBox)} overlaps the Sound button ${JSON.stringify(soundBox)}`,
          ).toBe(false);
          await page.waitForTimeout(700);
        }
      });

      test('a long chat name wraps beside the Remove button', async ({ page }) => {
        const { first } = world;
        await page.setExtraHTTPHeaders({ cookie: await signedCookie(first.member.sessionToken) });
        await page.goto(`/h/${first.houseId}/nights/${liveNightId}`);
        const messages = page.locator('.house-chat__message');
        await expect(messages).toHaveCount(2);
        for (const name of [spacedName, unbrokenName]) {
          await expect(
            page.getByRole('button', { name: `Remove message from ${name}` }),
          ).toBeVisible();
        }
        const rows = await messages.evaluateAll((articles) =>
          articles.map((article) => {
            const heading = article.querySelector('h3')!;
            const range = document.createRange();
            range.selectNodeContents(heading);
            const rect = (box: DOMRect) => ({
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            });
            return {
              name: heading.textContent ?? '',
              textRects: [...range.getClientRects()].map(rect),
              button: rect(article.querySelector('.house-chat__remove')!.getBoundingClientRect()),
              card: rect(article.getBoundingClientRect()),
            };
          }),
        );
        for (const row of rows) {
          expect(row.textRects.length, row.name).toBeGreaterThan(0);
          for (const text of row.textRects) {
            const crosses =
              Math.min(text.right, row.button.right) > Math.max(text.left, row.button.left) &&
              Math.min(text.bottom, row.button.bottom) > Math.max(text.top, row.button.top);
            expect(
              crosses,
              `${row.name}: name text ${JSON.stringify(text)} runs under Remove ${JSON.stringify(row.button)}`,
            ).toBe(false);
            expect(text.right, `${row.name} leaves the card`).toBeLessThanOrEqual(row.card.right);
          }
        }
      });
    });
  }
});
