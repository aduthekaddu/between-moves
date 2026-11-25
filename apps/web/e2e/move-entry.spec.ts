import AxeBuilder from '@axe-core/playwright';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { expect, test, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const seasonId = '01941f29-7c00-7000-8000-000000000921';
const gameId = '01941f29-7c00-7000-8000-000000000922';
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
  expect(
    scan.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
}

async function seedActiveGame(): Promise<void> {
  if (database === undefined) throw new Error('Move-entry database is not ready');
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
      seeded.first.nonOwner.sessionId,
      seeded.first.nonOwner.userId,
      seeded.first.nonOwner.sessionToken,
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
       move_due_at, created_at)
     values ($1, $2, $3, 'correspondence', 'active', $4, $5, $6, $6, 0, 'white', 0,
             '{"kind":"correspondence","perMoveHours":48}', $7, $8)`,
    [
      gameId,
      seeded.first.houseId,
      seasonId,
      seeded.first.member.membershipId,
      seeded.first.nonOwner.membershipId,
      initialFen,
      new Date('2099-09-10T08:00:00.000Z'),
      new Date('2026-09-01T08:00:00.000Z'),
    ],
  );
}

async function openGame(
  page: Page,
  sessionToken = fixture().first.member.sessionToken,
): Promise<void> {
  const seeded = fixture();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setExtraHTTPHeaders({
    cookie: await signedCookie(sessionToken),
    'x-request-id': 'bm-027-move-entry-e2e',
  });
  const response = await page.goto(`/h/${seeded.first.houseId}/games/${gameId}`);
  expect(response?.status()).toBe(200);
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
        'x-request-id': `bm-027-seed-ply-${input.expectedPly + 1}`,
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

test.describe('correspondence Move entry', () => {
  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl);
  });

  test.beforeEach(async () => {
    await seedActiveGame();
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-027] [UX-RESP-02] [UX-A11Y-04] plays a keyboard Move at 360 px with no confirm step and renders the server FEN', async ({
    page,
  }) => {
    await openGame(page);

    const board = page.getByRole('grid', { name: /Chessboard/ });
    await expect(board).toBeVisible();
    expect((await board.boundingBox())?.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expectNoBlockingAxeViolations(page);

    await page.locator('[data-square="e2"]').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
      'aria-label',
      'e4, empty, legal move',
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'You played e4' })).toBeVisible();
    await expectNoBlockingAxeViolations(page);

    await expect(page.getByText(/Move accepted: e4/)).toBeAttached({ timeout: 15_000 });
    await expect(page.locator('[data-square="e2"]')).toHaveAttribute('aria-label', 'e2, empty');
    await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
      'aria-label',
      'e4, white pawn',
    );
    await expect(page.getByTestId('turn-status')).toHaveText('Black to move');
    await expectNoBlockingAxeViolations(page);

    const persisted = await database?.pool.query(
      'select current_fen, current_ply, side_to_move, version from games where id = $1',
      [gameId],
    );
    expect(persisted?.rows).toEqual([
      { current_fen: afterE4Fen, current_ply: 1, side_to_move: 'black', version: 1 },
    ]);
  });

  test('[BM-027] [PR-EDGE-06] replaces an optimistic proposal with the canonical conflict position', async ({
    page,
  }) => {
    await openGame(page);
    await page.locator('[data-square="d2"]').click();
    await page.locator('[data-square="d4"]').click();
    await expect(page.getByText('You played d4', { exact: true })).toBeVisible();

    const competingMove = await page.request.post(
      `/api/houses/${fixture().first.houseId}/games/${gameId}/moves`,
      {
        headers: {
          cookie: await signedCookie(fixture().first.member.sessionToken),
          origin: 'http://127.0.0.1:3100',
          'x-request-id': 'bm-027-competing-move-e2e',
        },
        data: {
          expectedPly: 0,
          clientCommandId: '01941f29-7c00-7000-8000-000000000925',
          move: { from: 'e2', to: 'e4' },
        },
      },
    );
    expect(competingMove.status()).toBe(200);

    await expect(page.getByText("That position moved on. Here's the latest board.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-square="d2"]')).toHaveAttribute(
      'aria-label',
      'd2, white pawn',
    );
    await expect(page.locator('[data-square="d4"]')).toHaveAttribute('aria-label', 'd4, empty');
    await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
      'aria-label',
      'e4, white pawn',
    );
    await expect(page.getByTestId('turn-status')).toHaveText('Black to move');
    await expect(page.getByText('Move list (1)')).toBeVisible();
    await expect(page.locator('.move-list li')).toContainText('e4');
    await expect(page.getByRole('grid', { name: /Last move e2e4/ })).toBeVisible();
    await expect(page.locator('[role="gridcell"][aria-disabled="true"]')).toHaveCount(64);
    await expectNoBlockingAxeViolations(page);
  });

  test('[BM-027] refreshes terminal state and exposes a non-color check indicator', async ({
    page,
  }) => {
    const seeded = fixture();
    await seedMoveThroughCommand(page, {
      sessionToken: seeded.first.member.sessionToken,
      expectedPly: 0,
      clientCommandId: '01941f29-7c00-7000-8000-000000000926',
      from: 'f2',
      to: 'f3',
    });
    await seedMoveThroughCommand(page, {
      sessionToken: seeded.first.nonOwner.sessionToken,
      expectedPly: 1,
      clientCommandId: '01941f29-7c00-7000-8000-000000000927',
      from: 'e7',
      to: 'e5',
    });
    await seedMoveThroughCommand(page, {
      sessionToken: seeded.first.member.sessionToken,
      expectedPly: 2,
      clientCommandId: '01941f29-7c00-7000-8000-000000000928',
      from: 'g2',
      to: 'g4',
    });
    await openGame(page, fixture().first.nonOwner.sessionToken);

    await page.locator('[data-square="d8"]').click();
    await page.locator('[data-square="h4"]').click();

    await expect(page.getByText('Move accepted: Qh4#. Game complete.')).toBeAttached({
      timeout: 15_000,
    });
    await expect(page.getByText('You won by checkmate', { exact: true })).toBeVisible();
    await expect(page.getByTestId('turn-status')).toHaveText('Game complete');
    await expect(page.locator('[data-square="e1"]')).toHaveAttribute('data-check', 'true');
    await expect(page.locator('[data-square="e1"]')).toHaveAttribute(
      'aria-label',
      'e1, white king, in check',
    );
    await expect(page.getByRole('link', { name: 'Back to the House' })).toBeVisible();
    await expect(page.getByText('Move list (4)')).toBeVisible();
    await expect(page.getByText(/^Move due /)).toHaveCount(0);
    await expectNoBlockingAxeViolations(page);
  });

  test('[BM-027] takes back a slip with Undo, then plays by dragging the piece', async ({
    page,
  }) => {
    await openGame(page);
    await page.locator('[data-square="g1"]').click();
    await page.locator('[data-square="h3"]').click();
    await expect(page.getByText('You played Nh3', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-square="g1"]')).toHaveAttribute(
      'aria-label',
      'g1, white knight',
    );
    await page.waitForTimeout(6_000);
    const afterUndo = await database?.pool.query('select current_ply from games where id = $1', [
      gameId,
    ]);
    expect(afterUndo?.rows).toEqual([{ current_ply: 0 }]);

    const from = await page.locator('[data-square="e2"]').boundingBox();
    const to = await page.locator('[data-square="e4"]').boundingBox();
    if (from === null || to === null) throw new Error('Board squares are not on screen');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('[data-square="e4"]')).toHaveAttribute(
      'aria-label',
      'e4, white pawn',
    );
    await expect(page.getByText(/Move accepted: e4/)).toBeAttached({ timeout: 15_000 });
    const afterDrag = await database?.pool.query(
      'select current_fen, current_ply from games where id = $1',
      [gameId],
    );
    expect(afterDrag?.rows).toEqual([{ current_fen: afterE4Fen, current_ply: 1 }]);
  });
});
