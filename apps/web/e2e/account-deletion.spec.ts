import AxeBuilder from '@axe-core/playwright';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { readFile } from 'node:fs/promises';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const seasonId = '01941f29-7c00-7000-8000-000000005301';
const gameId = '01941f29-7c00-7000-8000-000000005302';
const beaNote = 'I should have seen Qxf7 coming.';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('Account deletion E2E fixture is not ready');
  return world;
}

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

/** Sign a browser in with a real cookie, so downloads and navigations carry it too. */
async function signIn(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    {
      name: 'between-moves.session_token',
      value: `${token}.${await makeSignature(token, secret)}`,
      url: 'http://127.0.0.1:3100',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Ada beat Bea in a completed Game, and Bea left a note on it. Both are signed in. */
async function seedCompletedGame(): Promise<void> {
  if (database === undefined) throw new Error('Account deletion E2E database is not ready');
  await resetTwoHousesWithMembers(database.pool);
  world = await twoHousesWithMembers(database.pool);
  const seeded = fixture();
  for (const member of [seeded.first.member, seeded.first.nonOwner]) {
    await database.pool.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, '2099-01-01T00:00:00.000Z')`,
      [member.sessionId, member.userId, member.sessionToken],
    );
  }
  await database.pool.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Deletion season', 'draft', now(), now())`,
    [seasonId, seeded.first.houseId],
  );
  await database.pool.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
       clock_policy, result, result_reason, completed_at, created_at)
     values ($1, $2, $3, 'correspondence', 'completed', $4, $5,
             '{"kind":"correspondence","perMoveHours":48}', 'white_win', 'resign', now(), now())`,
    [
      gameId,
      seeded.first.houseId,
      seasonId,
      seeded.first.member.membershipId,
      seeded.first.nonOwner.membershipId,
    ],
  );
  await database.pool.query(
    `insert into game_notes (id, game_id, house_id, membership_id, body)
     values ('01941f29-7c00-7000-8000-000000005303', $1, $2, $3, $4)`,
    [gameId, seeded.first.houseId, seeded.first.nonOwner.membershipId, beaNote],
  );
}

async function expectAccessible(page: Page): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(
    scan.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
}

test.describe('account export and deletion', () => {
  test.skip(testDatabaseUrl === undefined, 'TEST_DATABASE_URL is required for account E2E');

  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl ?? '');
  });

  test.beforeEach(async () => {
    await seedCompletedGame();
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-050] exports, deletes, and the House then shows Former member', async ({
    page,
    browser,
  }, testInfo) => {
    const seeded = fixture();
    const gamePath = `/h/${seeded.first.houseId}/games/${gameId}`;
    const adaContext = await browser.newContext();
    await signIn(adaContext, seeded.first.member.sessionToken);
    const adaPage = await adaContext.newPage();
    await adaPage.goto(gamePath);
    await expect(adaPage.getByText('Ada plays White. Bea plays Black.')).toBeVisible();
    await testInfo.attach('game-before-deletion', {
      body: await adaPage.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    await signIn(page.context(), seeded.first.nonOwner.sessionToken);
    await page.goto(`/h/${seeded.first.houseId}`);
    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page).toHaveURL('/account');
    await expect(page.getByRole('heading', { level: 1, name: 'Bea' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Knights at Dusk' })).toBeVisible();
    await expectAccessible(page);

    const downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download your data' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^between-moves-export-\d{4}-\d{2}-\d{2}\.json$/);
    const exportPath = await download.path();
    const exported = JSON.parse(await readFile(exportPath, 'utf8')) as {
      profile: { email: string };
      memberships: { houseName: string; status: string }[];
      authored: { notes: { body: string }[] };
      games: { gameId: string; color: string }[];
    };
    expect(exported.profile.email).toBe('bea-isolation@example.test');
    expect(exported.memberships).toEqual([
      expect.objectContaining({ houseName: 'Knights at Dusk', status: 'active' }),
    ]);
    expect(exported.authored.notes.map((note) => note.body)).toEqual([beaNote]);
    expect(exported.games).toEqual([expect.objectContaining({ gameId, color: 'black' })]);
    await testInfo.attach('account-export', { path: exportPath, contentType: 'application/json' });

    await page.getByRole('button', { name: 'Delete my account' }).click();
    const confirmDeletion = page.getByRole('button', { name: 'Delete forever' });
    await expect(confirmDeletion).toBeDisabled();
    await page.getByLabel('Type “delete my account” to confirm').fill('delete my account');
    await expectAccessible(page);
    await confirmDeletion.click();
    await expect(page).toHaveURL('/');

    // The browser dropped its sign-in cookie, and the server no longer honours the old one.
    expect(
      (await page.context().cookies()).filter((cookie) => cookie.name.includes('session_token')),
    ).toEqual([]);
    const viewer = await page.request.get('/api/viewer', {
      headers: { cookie: await signedCookie(seeded.first.nonOwner.sessionToken) },
    });
    expect(viewer.status()).toBe(401);
    // a signed-out visitor to /account is sent to sign in
    const account = await page.goto('/account');
    expect(new URL(account?.url() ?? '').pathname).toBe('/sign-in');

    await adaPage.reload();
    await expect(adaPage.getByText('Ada plays White. Former member plays Black.')).toBeVisible();
    const notes = adaPage.getByLabel('Members’ Game notes');
    await expect(notes.getByRole('heading', { name: 'Former member' })).toBeVisible();
    await expect(notes.getByText(beaNote, { exact: true })).toBeVisible();
    await expect(adaPage.getByText('Bea', { exact: true })).toHaveCount(0);
    await expectAccessible(adaPage);
    await testInfo.attach('game-after-deletion', {
      body: await adaPage.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    await expect(
      database?.pool.query(
        `select (select count(*)::int from games where id = $1) as games,
                (select status from memberships where id = $2) as membership`,
        [gameId, seeded.first.nonOwner.membershipId],
      ),
    ).resolves.toMatchObject({ rows: [{ games: 1, membership: 'left' }] });
    await adaContext.close();
  });

  test('[BM-050] asks an Owner to transfer ownership before deleting', async ({ page }) => {
    const seeded = fixture();
    await signIn(page.context(), seeded.first.member.sessionToken);
    await page.goto('/account');

    await expect(page.getByRole('heading', { level: 1, name: 'Ada' })).toBeVisible();
    await expect(
      page.getByText('You own Knights at Dusk. Transfer ownership before you delete your account.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete my account' })).toHaveCount(0);
    await expectAccessible(page);
  });
});
