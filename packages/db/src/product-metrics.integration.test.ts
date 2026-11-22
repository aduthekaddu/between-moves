import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp } from './migrations';
import { resetTwoHousesWithMembers, twoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const queryFile = new URL('../../../ops/product-metrics.sql', import.meta.url);

describe('[BM-052] product metrics on seeded Houses', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });

  beforeAll(async () => {
    await migrateUp(database, { migrationsDirectory });
    await resetTwoHousesWithMembers(database);
  });
  afterAll(async () => {
    await resetTwoHousesWithMembers(database);
    await database.end();
  });

  it('returns bounded aggregates for recent moves using the preceding move timestamp', async () => {
    const world = await twoHousesWithMembers(database);
    const seasonId = '01941f29-7c00-7000-8000-000000000981';
    const gameId = '01941f29-7c00-7000-8000-000000000982';
    const otherSeasonId = '01941f29-7c00-7000-8000-000000000991';
    const otherGameId = '01941f29-7c00-7000-8000-000000000992';
    const firstFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const secondFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const hourMs = 60 * 60 * 1000;
    const createdAt = new Date(Date.now() - 29 * 24 * hourMs);
    const oldMoveAt = new Date(createdAt.getTime() + 12 * hourMs);
    const recentMoveAt = new Date(createdAt.getTime() + 28 * 24 * hourMs);
    await database.query(
      `insert into seasons (id, house_id, title, state)
       values ($1, $2, 'Metrics season', 'draft'),
              ($3, $4, 'Other metrics season', 'draft')`,
      [seasonId, world.first.houseId, otherSeasonId, world.second.houseId],
    );
    await database.query(
      `insert into games (id, house_id, season_id, mode, state,
         white_membership_id, black_membership_id, clock_policy,
         current_fen, current_ply, side_to_move, version, created_at)
       values ($1, $2, $3, 'correspondence', 'active', $4, $5,
         '{"kind":"correspondence","perMoveHours":48}', $6, 2, 'white', 2, $7)`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        secondFen,
        createdAt,
      ],
    );
    await database.query(
      `insert into games (id, house_id, season_id, mode, state,
         white_membership_id, black_membership_id, clock_policy,
         current_fen, current_ply, side_to_move, version, created_at)
       values ($1, $2, $3, 'correspondence', 'active', $4, $5,
         '{"kind":"correspondence","perMoveHours":48}', $6, 1, 'black', 1, $7)`,
      [
        otherGameId,
        world.second.houseId,
        otherSeasonId,
        world.second.member.membershipId,
        world.second.nonOwner.membershipId,
        firstFen,
        createdAt,
      ],
    );
    await database.query(
      `insert into moves (id, game_id, house_id, ply, actor_membership_id,
         uci, san, fen_after, client_command_id, accepted_version, server_received_at)
       values ($1, $2, $3, 1, $4, 'e2e4', 'e4', $5, $6, 1, $7),
              ($8, $2, $3, 2, $9, 'e7e5', 'e5', $10, $11, 2, $12),
              ($13, $14, $15, 1, $16, 'e2e4', 'e4', $5, $17, 1, $7)`,
      [
        '01941f29-7c00-7000-8000-000000000983',
        gameId,
        world.first.houseId,
        world.first.member.membershipId,
        firstFen,
        '01941f29-7c00-7000-8000-000000000984',
        oldMoveAt,
        '01941f29-7c00-7000-8000-000000000985',
        world.first.nonOwner.membershipId,
        secondFen,
        '01941f29-7c00-7000-8000-000000000986',
        recentMoveAt,
        '01941f29-7c00-7000-8000-000000000993',
        otherGameId,
        world.second.houseId,
        world.second.member.membershipId,
        '01941f29-7c00-7000-8000-000000000994',
      ],
    );

    const sql = await readFile(queryFile, 'utf8');
    const result = await database.query<{ metric: string; value: string; sample_size: string }>(
      sql,
    );
    const metrics = Object.fromEntries(result.rows.map((row) => [row.metric, row]));
    expect(Object.keys(metrics)).toEqual([
      'active_member_rate_28d',
      'correspondence_move_median_hours_28d',
      'houses_with_a_move_28d',
      'night_attendance_rate_28d',
      'published_puzzles_28d',
    ]);
    expect(metrics.houses_with_a_move_28d).toMatchObject({ value: '1', sample_size: '2' });
    expect(Number(metrics.active_member_rate_28d?.value)).toBeGreaterThan(0);
    expect(Number(metrics.active_member_rate_28d?.value)).toBeLessThanOrEqual(1);
    expect(Number(metrics.night_attendance_rate_28d?.value)).toBe(0);
    expect(Number(metrics.correspondence_move_median_hours_28d?.value)).toBe(660);
    expect(metrics.correspondence_move_median_hours_28d?.sample_size).toBe('1');
    expect(sql).not.toContain('display_name');
  });
});
