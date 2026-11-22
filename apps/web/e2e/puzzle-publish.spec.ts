import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createDatabase, type Database } from '@between-moves/db/database';
import {
  resetTwoHousesWithMembers,
  twoHousesWithMembers,
  type TwoHousesWithMembers,
} from '@between-moves/db/testing';
import { makeSignature } from 'better-auth/crypto';
import { requireTestDatabaseUrl } from '@between-moves/db/test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const secret = 'e2e-better-auth-secret-at-least-32-characters';
const id = (number: number) => `01941f29-7c00-7000-8000-${String(number).padStart(12, '0')}`;
let database: Database | undefined;
let world: TwoHousesWithMembers | undefined;

test.describe('BM-046 House Puzzle publication', () => {
  test.beforeAll(async () => {
    database = createDatabase(testDatabaseUrl);
    await resetTwoHousesWithMembers(database.pool);
    world = await twoHousesWithMembers(database.pool);
    const first = world.first;
    const now = new Date();
    await database.pool.query(
      `insert into sessions (id,user_id,token,expires_at)
      values ($1,$2,$3,'2099-01-01T00:00:00Z')`,
      [first.member.sessionId, first.member.userId, first.member.sessionToken],
    );
    await database.pool.query(
      `insert into seasons (id,house_id,title,state,created_at,updated_at)
      values ($1,$2,'Puzzle season','draft',$3,$3)`,
      [id(4801), first.houseId, now],
    );
    await database.pool.query(
      `insert into season_charters
      (id,season_id,version,correspondence_pace_hours,night_recurrence,points_recipe,published_at,created_at)
      values ($1,$2,1,24,'{"weekday":2,"localTime":"19:30","count":4}',
      '{"completedGame":1,"win":2,"draw":1,"nightAttendance":1,"publishedPuzzle":1,"caps":{"games":8,"nights":4,"puzzles":2}}',$3,$3)`,
      [id(4802), id(4801), now],
    );
    await database.pool.query(
      `update seasons set state='active',starts_at=$2,ends_at=$3,published_charter_version=1 where id=$1`,
      [id(4801), new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 86_400_000)],
    );
    await database.pool.query(
      `insert into games (id,house_id,season_id,mode,state,white_membership_id,
      black_membership_id,clock_policy,current_ply,created_at,completed_at)
      values ($1,$2,$3,'correspondence','completed',$4,$5,$6,1,$7,$7)`,
      [
        id(4803),
        first.houseId,
        id(4801),
        first.member.membershipId,
        first.nonOwner.membershipId,
        { kind: 'correspondence', perMoveHours: 24 },
        now,
      ],
    );
    await database.pool.query(
      `insert into analysis_jobs
      (id,source_event_id,game_id,house_id,engine_version,state,result,created_at,completed_at)
      values ($1,$2,$3,$4,'v1','completed','{"swings":[]}',$5,$5)`,
      [id(4804), id(4805), id(4803), first.houseId, now],
    );
    await database.pool.query(
      `insert into puzzle_candidates
      (id,analysis_job_id,game_id,house_id,season_id,source_ply,position_fen,best_line,evaluation_swing_cp,created_at)
      values ($1,$2,$3,$4,$5,1,$6,'["e2e4"]',300,$7)`,
      [
        id(4806),
        id(4804),
        id(4803),
        first.houseId,
        id(4801),
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        now,
      ],
    );
  });

  test.afterAll(async () => {
    if (database === undefined) return;
    await resetTwoHousesWithMembers(database.pool);
    await database.close();
  });

  test('member confirms position and prompt, then sees the private published puzzle', async ({
    page,
  }) => {
    const first = world!.first;
    const cookie = `between-moves.session_token=${first.member.sessionToken}.${await makeSignature(first.member.sessionToken, secret)}`;
    await page.setExtraHTTPHeaders({ cookie });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${first.houseId}/puzzles`);
    await expect(page.getByRole('heading', { name: 'House Puzzles' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review this position' })).toBeVisible();
    const scan = await new AxeBuilder({ page }).analyze();
    expect(scan.violations).toEqual([]);
    await page.getByRole('checkbox', { name: /I confirm this position/ }).check();
    await page
      .getByLabel('Prompt for the House')
      .fill('What would you play from the starting position?');
    await page.getByRole('button', { name: 'Confirm & publish' }).click();
    await expect(
      page.getByRole('heading', { name: 'What would you play from the starting position?' }),
    ).toBeVisible();
    await expect(page.getByText('Contributed by Ada')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const published = await database!.pool.query('select id from house_puzzles where house_id=$1', [
      first.houseId,
    ]);
    expect(published.rowCount).toBe(1);
    const outbox = await database!.pool.query(
      "select id from outbox_events where house_id=$1 and topic='puzzle.published'",
      [first.houseId],
    );
    expect(outbox.rowCount).toBe(1);
  });
});
