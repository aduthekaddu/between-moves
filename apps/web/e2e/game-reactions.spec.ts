import AxeBuilder from '@axe-core/playwright';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { expect, test } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const seasonId = '01941f29-7c00-7000-8000-000000000941';
const gameId = '01941f29-7c00-7000-8000-000000000942';
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

function fixture(): TwoHousesWithMembers {
  if (world === undefined) throw new Error('Reaction E2E fixture is not ready');
  return world;
}

async function signedCookie(token: string): Promise<string> {
  return `between-moves.session_token=${token}.${await makeSignature(token, secret)}`;
}

async function seedCompletedGame(): Promise<void> {
  if (database === undefined) throw new Error('Reaction E2E database is not ready');
  await resetTwoHousesWithMembers(database.pool);
  world = await twoHousesWithMembers(database.pool);
  const seeded = fixture();
  await database.pool.query(
    `insert into sessions (id, user_id, token, expires_at)
     values ($1, $2, $3, '2099-01-01T00:00:00.000Z')`,
    [seeded.first.member.sessionId, seeded.first.member.userId, seeded.first.member.sessionToken],
  );
  await database.pool.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Reaction season', 'draft', now(), now())`,
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
}

test.describe('completed Game Reactions', () => {
  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl);
  });

  test.beforeEach(async () => {
    await seedCompletedGame();
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('[BM-031] [DR-REACT-01] changes one persisted Reaction on a completed Game', async ({
    page,
  }) => {
    const seeded = fixture();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.setExtraHTTPHeaders({
      cookie: await signedCookie(seeded.first.member.sessionToken),
      'x-request-id': 'bm-031-reaction-e2e',
    });
    const response = await page.goto(`/h/${seeded.first.houseId}/games/${gameId}`);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { name: 'React to this Game' })).toBeVisible();
    await page.getByRole('button', { name: 'Brilliant' }).click();
    await expect(page.getByText('Brilliant is your current Reaction.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Brilliant selected/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'Funny' }).click();
    await expect(page.getByText('Funny is your current Reaction.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Funny selected/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      database?.pool.query(
        'select reaction from game_reactions where game_id=$1 and membership_id=$2',
        [gameId, seeded.first.member.membershipId],
      ),
    ).resolves.toMatchObject({ rowCount: 1, rows: [{ reaction: 'funny' }] });

    await page.reload();
    await expect(page.getByRole('button', { name: /Funny selected/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const scan = await new AxeBuilder({ page }).analyze();
    expect(
      scan.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      ),
    ).toEqual([]);
  });
});
