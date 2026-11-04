import AxeBuilder from '@axe-core/playwright';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { expect, test, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const seasonId = '01941f29-7c00-7000-8000-000000000941';
const gameId = '01941f29-7c00-7000-8000-000000000942';
const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const afterE4Fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('Move-entry E2E fixture is not ready');
  return world;
}

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

async function expectNoBlockingAxeViolations(page: Page): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
}

async function seedActiveGame(): Promise<void> {
  if (database === undefined) throw new Error('Move-entry database is not ready');
  await resetTwoHousesWithMembers(database.pool);
  world = await twoHousesWithMembers(database.pool);
  const seeded = fixture();
  await database.pool.query(
    `insert into sessions (id, user_id, token, expires_at)
     values ($1, $2, $3, '2099-01-01T00:00:00.000Z'),
            ($4, $5, $6, '2099-01-01T00:00:00.000Z'),
            ($7, $8, $9, '2099-01-01T00:00:00.000Z'),
            ($10, $11, $12, '2099-01-01T00:00:00.000Z')`,
    [
      seeded.first.member.sessionId,
      seeded.first.member.userId,
      seeded.first.member.sessionToken,
      seeded.first.nonOwner.sessionId,
      seeded.first.nonOwner.userId,
      seeded.first.nonOwner.sessionToken,
      seeded.switchingMember.sessionId,
      seeded.switchingMember.userId,
      seeded.switchingMember.sessionToken,
      seeded.second.member.sessionId,
      seeded.second.member.userId,
      seeded.second.member.sessionToken,
    ],
  );
  await database.pool.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Board season', 'draft', $3, $3)`,
    [seasonId, seeded.first.houseId, new Date('2026-09-01T08:00:00.000Z')],
  );
  await database.pool.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
       initial_fen, current_fen, current_ply, side_to_move, version, clock_policy,
       white_clock_ms, black_clock_ms, turn_started_at, created_at)
     values ($1, $2, $3, 'live', 'active', $4, $5, $6, $6, 0, 'white', 0,
             '{"kind":"live","initialMs":300000,"incrementMs":2000}', 300000, 300000, $7, $8)`,
    [
      gameId,
      seeded.first.houseId,
      seasonId,
      seeded.first.member.membershipId,
      seeded.first.nonOwner.membershipId,
      initialFen,
      new Date(),
      new Date('2026-09-01T08:00:00.000Z'),
    ],
  );
}

async function openGame(
  page: Page,
  sessionToken = fixture().first.member.sessionToken,
): Promise<void> {
  const seeded = fixture();
  await page.setViewportSize({ width: 768, height: 900 });
  await page.setExtraHTTPHeaders({
    cookie: await signedCookie(sessionToken),
    'x-request-id': 'bm-042-move-entry-e2e',
  });
  const hydratedSnapshot = page.waitForResponse(
    (response) => response.url().endsWith(positionUrl()) && response.status() === 200,
  );
  const response = await page.goto(`/h/${seeded.first.houseId}/games/${gameId}/live`);
  await hydratedSnapshot;
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-square][data-movable]').first()).toBeVisible();
  await expect(
    page.getByText('Refreshing the canonical Game before Move entry resumes.'),
  ).toHaveCount(0);
}

async function seedMoveThroughCommand(
  page: Page,
  input: {
    readonly sessionToken: string;
    readonly expectedPly: number;
    readonly clientCommandId: string;
    readonly from: string;
    readonly to: string;
  },
): Promise<void> {
  const response = await page.request.post(
    `/api/houses/${fixture().first.houseId}/games/${gameId}/moves`,
    {
      headers: {
        cookie: await signedCookie(input.sessionToken),
        origin: 'http://127.0.0.1:3100',
        'x-request-id': `bm-042-seed-ply-${input.expectedPly + 1}`,
      },
      data: {
        expectedPly: input.expectedPly,
        clientCommandId: input.clientCommandId,
        move: { from: input.from, to: input.to },
      },
    },
  );
  expect(response.status()).toBe(200);
}

function clockSeconds(text: string | null): number {
  const [minutes = NaN, seconds = NaN] = (text ?? '').split(':').map(Number);
  return minutes * 60 + seconds;
}

function positionUrl() {
  return `/api/houses/${fixture().first.houseId}/games/${gameId}`;
}

async function submitE4(page: Page) {
  await page.locator('[data-square="e2"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('white-clock')).toBeInViewport();
  await expect(page.getByTestId('black-clock')).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Move accepted: e4/)).toBeAttached();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
}

test.use({ video: 'on' });

test.describe('[BM-042] live board', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for live board E2E');
  test.beforeAll(() => {
    database = createDatabase(testDatabaseUrl ?? '');
  });
  test.beforeEach(seedActiveGame);
  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('keyboard move at 768 px reconciles both clocks and passes axe', async ({
    page,
  }, testInfo) => {
    await openGame(page);
    const white = page.getByTestId('white-clock');
    const black = page.getByTestId('black-clock');
    const before = clockSeconds(await white.textContent());
    await expect.poll(async () => clockSeconds(await white.textContent())).toBeLessThan(before);
    await expect(black).toHaveText('5:00');
    await expectNoBlockingAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath('live-before-move.png'), fullPage: true });
    await submitE4(page);
    await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
      'aria-label',
      'e4, white pawn',
    );
    await expect(page.getByTestId('turn-status')).toHaveText('Black to move');
    const saved = await database!.pool.query(
      'select current_fen, current_ply, white_clock_ms from games where id = $1',
      [gameId],
    );
    expect(saved.rows[0].current_fen).toBe(afterE4Fen);
    expect(saved.rows[0].current_ply).toBe(1);
    expect(clockSeconds(await white.textContent())).toBe(
      Math.ceil(saved.rows[0].white_clock_ms / 1000),
    );
    const stoppedWhite = await white.textContent();
    const blackBefore = clockSeconds(await black.textContent());
    await expect
      .poll(async () => clockSeconds(await black.textContent()))
      .toBeLessThan(blackBefore);
    await expect(white).toHaveText(stoppedWhite!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expectNoBlockingAxeViolations(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('live-after-move.png'), fullPage: true });
  });

  test('[BM-043] a spectator subscribes and sees live moves without move controls', async ({
    page,
  }, testInfo) => {
    const seeded = fixture();
    await page.setViewportSize({ width: 768, height: 900 });
    await page.setExtraHTTPHeaders({
      cookie: await signedCookie(seeded.switchingMember.sessionToken),
    });
    const tokenResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/houses/${seeded.first.houseId}/games/${gameId}/realtime-token`),
    );
    const streamResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/houses/${seeded.first.houseId}/games/${gameId}/live?token=`),
    );
    const response = await page.goto(`/h/${seeded.first.houseId}/games/${gameId}/live`);
    expect(response?.status()).toBe(200);
    expect((await tokenResponse).status()).toBe(200);
    expect((await streamResponse).status()).toBe(200);
    await expect(page.getByText("Only seated players can move. You're spectating.")).toBeVisible();
    await expect(page.locator('[data-movable]')).toHaveCount(0);
    await expect(page.locator('[role="gridcell"][aria-disabled="true"]')).toHaveCount(64);
    await page.screenshot({
      path: testInfo.outputPath('spectator-before-move.png'),
      fullPage: true,
    });

    const rejected = await page.request.post(
      `/api/houses/${seeded.first.houseId}/games/${gameId}/moves`,
      {
        headers: {
          cookie: await signedCookie(seeded.switchingMember.sessionToken),
          origin: 'http://127.0.0.1:3100',
        },
        data: {
          expectedPly: 0,
          clientCommandId: '01941f29-7c00-7000-8000-000000000953',
          move: { from: 'e2', to: 'e4' },
        },
      },
    );
    expect(rejected.status()).toBe(403);
    await seedMoveThroughCommand(page, {
      sessionToken: seeded.first.member.sessionToken,
      expectedPly: 0,
      clientCommandId: '01941f29-7c00-7000-8000-000000000954',
      from: 'e2',
      to: 'e4',
    });
    await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
      'aria-label',
      'e4, white pawn',
      { timeout: 7000 },
    );
    await expect(page.locator('[data-movable]')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('spectator-after-move.png'),
      fullPage: true,
    });
    const saved = await database!.pool.query('select current_ply from games where id = $1', [
      gameId,
    ]);
    expect(saved.rows[0].current_ply).toBe(1);
  });

  test('[BM-043] another House cannot spectate or subscribe to the live Game', async ({ page }) => {
    const seeded = fixture();
    const cookie = await signedCookie(seeded.second.member.sessionToken);
    await page.setExtraHTTPHeaders({ cookie });
    const pageResponse = await page.goto(`/h/${seeded.first.houseId}/games/${gameId}/live`);
    expect(pageResponse?.status()).toBe(404);
    const token = await page.request.post(
      `/api/houses/${seeded.first.houseId}/games/${gameId}/realtime-token`,
      { headers: { cookie, origin: 'http://127.0.0.1:3100' } },
    );
    expect(token.status()).toBe(404);
  });

  test('refocus replaces a drifted clock with server time despite a wrong device date', async ({
    page,
  }, testInfo) => {
    await openGame(page);
    await page.clock.setFixedTime(new Date('2040-01-01T00:00:00Z'));
    await database!.pool.query(
      'update games set white_clock_ms = 90000, turn_started_at = now() where id = $1',
      [gameId],
    );
    const refreshed = page.waitForResponse(
      (response) => response.url().endsWith(positionUrl()) && response.status() === 200,
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const snapshot = await (await refreshed).json();
    const expectedMs =
      snapshot.liveClock.whiteMs -
      Math.max(0, Date.parse(snapshot.serverNow) - Date.parse(snapshot.liveClock.turnStartedAt));
    await expect
      .poll(async () =>
        Math.abs(
          clockSeconds(await page.getByTestId('white-clock').textContent()) -
            Math.ceil(expectedMs / 1000),
        ),
      )
      .toBeLessThanOrEqual(1);
    await expect(page.getByTestId('black-clock')).toHaveText('5:00');
    await page.screenshot({ path: testInfo.outputPath('live-refocus.png'), fullPage: true });
  });

  test('Black sees their orientation and reconciles on return from another tab', async ({
    page,
    context,
  }, testInfo) => {
    await seedMoveThroughCommand(page, {
      sessionToken: fixture().first.member.sessionToken,
      expectedPly: 0,
      clientCommandId: '01941f29-7c00-7000-8000-000000000945',
      from: 'e2',
      to: 'e4',
    });
    await openGame(page, fixture().first.nonOwner.sessionToken);
    await expect(page.locator('[data-square]').first()).toHaveAttribute('data-square', 'h1');
    await expect(page.locator('.live-clock').first()).toContainText('Black · Bea');
    const otherTab = await context.newPage();
    await otherTab.goto('about:blank');
    await otherTab.bringToFront();
    await database!.pool.query(
      'update games set black_clock_ms = 90000, turn_started_at = now() where id = $1',
      [gameId],
    );
    const refreshed = page.waitForResponse(
      (response) => response.url().endsWith(positionUrl()) && response.status() === 200,
    );
    await page.bringToFront();
    const snapshot = await (await refreshed).json();
    const expectedSeconds = Math.ceil(
      (snapshot.liveClock.blackMs -
        Math.max(
          0,
          Date.parse(snapshot.serverNow) - Date.parse(snapshot.liveClock.turnStartedAt),
        )) /
        1000,
    );
    await expect
      .poll(async () =>
        Math.abs(
          clockSeconds(await page.getByTestId('black-clock').textContent()) - expectedSeconds,
        ),
      )
      .toBeLessThanOrEqual(1);
    await expect(page.getByTestId('black-clock')).toBeInViewport();
    await page.locator('[data-square="e7"]').click();
    await page.locator('[data-square="e5"]').click();
    await expect(page.getByText(/Move accepted: e5/)).toBeAttached();
    await expect(page.getByTestId('turn-status')).toHaveText('White to move');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath('black-after-tab-return.png'),
      fullPage: true,
    });
    await otherTab.close();
  });

  test('receives an opponent move while open and clears an outdated selection', async ({
    page,
  }) => {
    await openGame(page);
    await page.locator('[data-square="d2"]').click();
    await seedMoveThroughCommand(page, {
      sessionToken: fixture().first.member.sessionToken,
      expectedPly: 0,
      clientCommandId: '01941f29-7c00-7000-8000-000000000943',
      from: 'e2',
      to: 'e4',
    });
    await expect(page.getByTestId('turn-status')).toHaveText('Black to move', { timeout: 7000 });
    await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);
    await seedMoveThroughCommand(page, {
      sessionToken: fixture().first.nonOwner.sessionToken,
      expectedPly: 1,
      clientCommandId: '01941f29-7c00-7000-8000-000000000944',
      from: 'e7',
      to: 'e5',
    });
    await expect(page.getByTestId('turn-status')).toHaveText('White to move', { timeout: 7000 });
    await expect(page.locator('[data-square="e5"]')).toHaveAttribute(
      'aria-label',
      'e5, black pawn',
    );
    await expect(page.getByText('Your move', { exact: true })).toBeVisible();
  });

  test('does not let an older in-flight read overwrite a submitted move', async ({ page }) => {
    await openGame(page);
    let releaseRead: (() => void) | undefined;
    let readStarted: (() => void) | undefined;
    let readFinished: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => {
      readFinished = resolve;
    });
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let first = true;
    await page.route(`**${positionUrl()}`, async (route) => {
      if (!first) {
        await route.continue();
        return;
      }
      first = false;
      const stale = await route.fetch();
      readStarted?.();
      await held;
      await route.fulfill({ response: stale }).catch(() => {});
      readFinished?.();
    });
    await started; // Hold the periodic read, leaving move entry available.
    await submitE4(page);
    releaseRead?.();
    await finished;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByTestId('turn-status')).toHaveText('Black to move');
    await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
      'aria-label',
      'e4, white pawn',
    );
    await expect(page.getByText('Move list (1)')).toBeVisible();
    await page.unroute(`**${positionUrl()}`);
  });

  test('offers recovery on failed focus sync and rejects a malformed live clock', async ({
    page,
  }) => {
    await openGame(page);
    await page.route(`**${positionUrl()}`, (route) => route.fulfill({ status: 503, body: '{}' }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Could not sync the Game. Refresh before moving.')).toBeVisible();
    await expect(page.locator('[role="gridcell"][aria-disabled="true"]')).toHaveCount(64);
    await page.unroute(`**${positionUrl()}`);
    await page.route(`**${positionUrl()}`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ json: { ...body, liveClock: { ...body.liveClock, whiteMs: -1 } } });
    });
    const malformedRead = page.waitForResponse(
      (response) => response.url().endsWith(positionUrl()) && response.status() === 200,
    );
    await page.getByRole('button', { name: 'Refresh board' }).click();
    await malformedRead;
    await expect(page.getByRole('button', { name: 'Refresh board' })).toBeVisible();
    await expect(page.getByText('Could not sync the Game. Refresh before moving.')).toBeVisible();
    await page.unroute(`**${positionUrl()}`);
    await page.getByRole('button', { name: 'Refresh board' }).click();
    await expect(page.getByText('Your move', { exact: true })).toBeVisible();
    await expect(page.locator('.move-entry').getByRole('alert')).toHaveCount(0);
  });

  test('keeps live play read-only below 768 px and enables it at the boundary', async ({
    page,
  }) => {
    await openGame(page);
    await page.setViewportSize({ width: 767, height: 900 });
    await expect(page.getByText(/Live play needs a screen/)).toBeVisible();
    await expect(page.locator('[role="gridcell"][aria-disabled="true"]')).toHaveCount(64);
    await expect(page.locator('[data-movable]')).toHaveCount(0);
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.getByText(/Live play needs a screen/)).toHaveCount(0);
    await submitE4(page);
  });

  test('shows zero without declaring a result until the server confirms flag fall', async ({
    page,
  }) => {
    await database!.pool.query('update games set white_clock_ms = 0 where id = $1', [gameId]);
    await openGame(page);
    await expect(page.getByTestId('white-clock')).toHaveText('0:00');
    await expect(page.getByTestId('turn-status')).toHaveText('White to move');
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await expect(page.getByTestId('turn-status')).toHaveText('Game complete');
    await expect(page.getByText('Bea won', { exact: true })).toBeVisible();
    await expect(page.getByTestId('white-clock')).toHaveText('0:00');
    await expect(page.locator('.live-clock[data-running="true"]')).toHaveCount(0);
    await expectNoBlockingAxeViolations(page);
  });
});
