import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgGameNoteRepository } from './pg-game-note-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

describe('PostgreSQL Game note repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const repository = new PgGameNoteRepository(database);
  const gameId = id(951);
  const seasonId = id(952);
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await database.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Note season', 'draft', now(), now())`,
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

  it('[BM-032] [DR-NOTE-01] creates then edits one note without replacing its identity', async () => {
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    const createdAt = new Date('2026-09-16T08:00:00.000Z');
    const editedAt = new Date('2026-09-16T08:01:00.000Z');

    await expect(
      repository.save(context, {
        id: id(953),
        gameId,
        body: '<script>alert(1)</script>',
        savedAt: createdAt,
      }),
    ).resolves.toMatchObject({
      membershipId: world.first.member.membershipId,
      authorDisplayName: world.first.member.displayName,
      body: '<script>alert(1)</script>',
      createdAt,
      editedAt: null,
    });
    await expect(
      repository.save(context, {
        id: id(954),
        gameId,
        body: 'Edited reflection',
        savedAt: editedAt,
      }),
    ).resolves.toMatchObject({
      body: 'Edited reflection',
      createdAt,
      editedAt,
    });

    await expect(
      database.query(
        'select id::text, body, created_at, edited_at from game_notes where game_id=$1',
        [gameId],
      ),
    ).resolves.toMatchObject({
      rowCount: 1,
      rows: [
        { id: id(953), body: 'Edited reflection', created_at: createdAt, edited_at: editedAt },
      ],
    });
    await expect(repository.readForGame(context, gameId)).resolves.toMatchObject({
      currentMembershipId: world.first.member.membershipId,
      notes: [{ body: 'Edited reflection', editedAt }],
    });
  });

  it('[BM-032] lists notes oldest first and names a Member who left as Former member', async () => {
    const owner = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    const other = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.nonOwner.userId,
    });
    await expect(repository.readForGame(owner, gameId)).resolves.toMatchObject({
      currentMembershipId: world.first.member.membershipId,
      notes: [],
    });

    await repository.save(other, {
      id: id(960),
      gameId,
      body: 'Opponent first',
      savedAt: new Date('2026-09-16T08:00:00.000Z'),
    });
    await repository.save(owner, {
      id: id(961),
      gameId,
      body: 'Owner second',
      savedAt: new Date('2026-09-16T08:05:00.000Z'),
    });
    await database.query(`update memberships set status = 'left', left_at = now() where id = $1`, [
      world.first.nonOwner.membershipId,
    ]);

    const view = await repository.readForGame(owner, gameId);
    expect(view?.notes.map((note) => [note.body, note.authorDisplayName])).toEqual([
      ['Opponent first', 'Former member'],
      ['Owner second', world.first.member.displayName],
    ]);
  });

  it('[BM-032] rejects empty and over-2000-character notes at the database boundary', async () => {
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    await expect(
      repository.save(context, { id: id(955), gameId, body: '', savedAt: new Date() }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      repository.save(context, {
        id: id(956),
        gameId,
        body: 'a'.repeat(2_001),
        savedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('[BM-032] [DR-GAME-05] accepts notes only for completed Games', async () => {
    await database.query(
      `update games set state='active', result=null, result_reason=null, completed_at=null where id=$1`,
      [gameId],
    );
    const context = fakeAuthorizationContext({
      houseId: world.first.houseId,
      viewerId: world.first.member.userId,
    });
    await expect(
      repository.save(context, { id: id(957), gameId, body: 'Too soon', savedAt: new Date() }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(repository.readForGame(context, gameId)).resolves.toBeNull();
  });

  it('[BM-032] [DR-SEC-01] isolates note writes and reads by House', async () => {
    const otherHouse = fakeAuthorizationContext({
      houseId: world.second.houseId,
      viewerId: world.second.member.userId,
    });
    await expect(
      repository.save(otherHouse, {
        id: id(958),
        gameId,
        body: 'Crossed House',
        savedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(repository.readForGame(otherHouse, gameId)).resolves.toBeNull();
    await expect(
      database.query('select count(*)::int as count from game_notes'),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });
});
