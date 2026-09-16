import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgGameReactionRepository } from './pg-game-reaction-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

integration('PostgreSQL Game Reaction repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const repository = new PgGameReactionRepository(database);
  const gameId = id(931);
  const seasonId = id(932);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await database.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Reaction season', 'draft', now(), now())`,
      [seasonId, world.first.houseId],
    );
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         clock_policy, result, result_reason, completed_at, created_at)
       values ($1, $2, $3, 'correspondence', 'completed', $4, $5,
               '{"kind":"correspondence","perMoveHours":48}', 'white_win', 'resign', now(), now())`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
      ],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-031] [DR-REACT-01] replaces a Member Reaction without duplicating it', async () => {
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    const firstAt = new Date('2026-09-16T08:00:00.000Z');
    const changedAt = new Date('2026-09-16T08:01:00.000Z');

    await expect(
      repository.set(context, {
        id: id(933),
        gameId,
        reaction: 'well_played',
        reactedAt: firstAt,
      }),
    ).resolves.toEqual({
      membershipId: world.first.member.membershipId,
      reaction: 'well_played',
      reactedAt: firstAt,
    });
    await expect(
      repository.set(context, {
        id: id(934),
        gameId,
        reaction: 'dramatic',
        reactedAt: changedAt,
      }),
    ).resolves.toEqual({
      membershipId: world.first.member.membershipId,
      reaction: 'dramatic',
      reactedAt: changedAt,
    });

    await expect(
      database.query('select id::text, reaction, created_at from game_reactions where game_id=$1', [
        gameId,
      ]),
    ).resolves.toMatchObject({
      rowCount: 1,
      rows: [{ id: id(933), reaction: 'dramatic', created_at: changedAt }],
    });
    await expect(repository.readCurrent(context, gameId)).resolves.toBe('dramatic');
  });

  it('[BM-031] [DR-GAME-05] rejects Reactions until the Game is completed', async () => {
    await database.query(
      `update games set state='active', result=null, result_reason=null, completed_at=null where id=$1`,
      [gameId],
    );
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });

    await expect(
      repository.set(context, {
        id: id(935),
        gameId,
        reaction: 'funny',
        reactedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('[BM-031] [DR-SEC-01] denies cross-House writes and reads', async () => {
    const otherHouse = fakeAuthorizationContext({
      houseId: world.second.houseId,
      viewerId: world.second.member.userId,
    });
    await expect(
      repository.set(otherHouse, {
        id: id(936),
        gameId,
        reaction: 'brilliant',
        reactedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(repository.readCurrent(otherHouse, gameId)).resolves.toBeNull();
    await expect(
      database.query('select count(*)::int as count from game_reactions'),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });
});
