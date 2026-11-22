import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgMoveShelfRepository } from './pg-move-shelf-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';
import { requireTestDatabaseUrl } from './test-database';

const testDatabaseUrl = requireTestDatabaseUrl();
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const createdAt = new Date('2026-09-01T08:00:00.000Z');

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

async function createSeason(database: Pool, seasonId: string, houseId: string): Promise<void> {
  await database.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Shelf season', 'draft', $3, $3)`,
    [seasonId, houseId, createdAt],
  );
}

interface CorrespondenceGameFixture {
  readonly id: string;
  readonly houseId: string;
  readonly seasonId: string;
  readonly whiteMembershipId: string;
  readonly blackMembershipId: string;
  readonly state: 'active' | 'completed';
  readonly sideToMove: 'white' | 'black';
  readonly moveDueAt?: Date;
  readonly completedAt?: Date;
  readonly result?: 'white_win' | 'black_win' | 'draw';
}

async function createCorrespondenceGame(
  database: Pool,
  game: CorrespondenceGameFixture,
): Promise<void> {
  await database.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
       side_to_move, result, result_reason, clock_policy, move_due_at, completed_at, created_at)
     values ($1, $2, $3, 'correspondence', $4, $5, $6, $7, $8,
             case when $4 = 'completed' then 'agreement' else null end,
             '{"kind":"correspondence","perMoveHours":48}', $9, $10, $11)`,
    [
      game.id,
      game.houseId,
      game.seasonId,
      game.state,
      game.whiteMembershipId,
      game.blackMembershipId,
      game.sideToMove,
      game.result ?? null,
      game.moveDueAt ?? null,
      game.completedAt ?? null,
      createdAt,
    ],
  );
}

describe('PostgreSQL Move Shelf query', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const repository = new PgMoveShelfRepository(database);
  let world: TwoHousesWithMembers;
  const firstSeasonId = id(701);
  const secondSeasonId = id(702);

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await createSeason(database, firstSeasonId, world.first.houseId);
    await createSeason(database, secondSeasonId, world.second.houseId);

    const viewer = world.switchingMember;
    await Promise.all([
      createCorrespondenceGame(database, {
        id: id(801),
        houseId: world.first.houseId,
        seasonId: firstSeasonId,
        whiteMembershipId: world.first.member.membershipId,
        blackMembershipId: viewer.firstMembershipId,
        state: 'active',
        sideToMove: 'black',
        moveDueAt: new Date('2026-09-08T09:00:00.000Z'),
      }),
      createCorrespondenceGame(database, {
        id: id(802),
        houseId: world.first.houseId,
        seasonId: firstSeasonId,
        whiteMembershipId: viewer.firstMembershipId,
        blackMembershipId: world.first.nonOwner.membershipId,
        state: 'active',
        sideToMove: 'white',
        moveDueAt: new Date('2026-09-10T09:00:00.000Z'),
      }),
      createCorrespondenceGame(database, {
        id: id(803),
        houseId: world.first.houseId,
        seasonId: firstSeasonId,
        whiteMembershipId: viewer.firstMembershipId,
        blackMembershipId: world.first.member.membershipId,
        state: 'active',
        sideToMove: 'black',
        moveDueAt: new Date('2026-09-09T09:00:00.000Z'),
      }),
      createCorrespondenceGame(database, {
        id: id(804),
        houseId: world.first.houseId,
        seasonId: firstSeasonId,
        whiteMembershipId: world.first.nonOwner.membershipId,
        blackMembershipId: viewer.firstMembershipId,
        state: 'active',
        sideToMove: 'white',
        moveDueAt: new Date('2026-09-12T09:00:00.000Z'),
      }),
      createCorrespondenceGame(database, {
        id: id(805),
        houseId: world.first.houseId,
        seasonId: firstSeasonId,
        whiteMembershipId: viewer.firstMembershipId,
        blackMembershipId: world.first.member.membershipId,
        state: 'completed',
        sideToMove: 'black',
        result: 'draw',
        completedAt: new Date('2026-09-01T10:00:00.000Z'),
      }),
      createCorrespondenceGame(database, {
        id: id(806),
        houseId: world.first.houseId,
        seasonId: firstSeasonId,
        whiteMembershipId: world.first.nonOwner.membershipId,
        blackMembershipId: viewer.firstMembershipId,
        state: 'completed',
        sideToMove: 'white',
        result: 'black_win',
        completedAt: new Date('2026-09-06T10:00:00.000Z'),
      }),
      createCorrespondenceGame(database, {
        id: id(807),
        houseId: world.first.houseId,
        seasonId: firstSeasonId,
        whiteMembershipId: world.first.member.membershipId,
        blackMembershipId: world.first.nonOwner.membershipId,
        state: 'active',
        sideToMove: 'white',
        moveDueAt: new Date('2026-09-07T09:00:00.000Z'),
      }),
      createCorrespondenceGame(database, {
        id: id(808),
        houseId: world.second.houseId,
        seasonId: secondSeasonId,
        whiteMembershipId: world.second.member.membershipId,
        blackMembershipId: viewer.secondMembershipId,
        state: 'active',
        sideToMove: 'black',
        moveDueAt: new Date('2026-09-07T08:00:00.000Z'),
      }),
    ]);
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         side_to_move, clock_policy, white_clock_ms, black_clock_ms, created_at)
       values ($1, $2, $3, 'live', 'active', $4, $5, 'white',
               '{"kind":"live","initialMs":300000,"incrementMs":0}', 300000, 300000, $6)`,
      [
        id(809),
        world.first.houseId,
        firstSeasonId,
        world.switchingMember.firstMembershipId,
        world.first.member.membershipId,
        createdAt,
      ],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-026] [DR-SHELF-01] groups and orders correspondence Games for the viewer', async () => {
    const shelf = await repository.readMoveShelf(
      fakeAuthorizationContext({
        houseId: world.first.houseId,
        viewerId: world.switchingMember.userId,
      }),
    );

    expect(shelf?.yourMove.map((game) => game.gameId)).toEqual([id(801), id(802)]);
    expect(shelf?.waiting.map((game) => game.gameId)).toEqual([id(803), id(804)]);
    expect(shelf?.recent.map((game) => game.gameId)).toEqual([id(806), id(805)]);
    expect(shelf?.yourMove.map((game) => game.opponentName)).toEqual(['Ada', 'Bea']);
    expect(shelf?.recent.map((game) => game.result)).toEqual(['black_win', 'draw']);
    expect([
      ...(shelf?.yourMove ?? []),
      ...(shelf?.waiting ?? []),
      ...(shelf?.recent ?? []),
    ]).not.toContainEqual(expect.objectContaining({ gameId: id(809) }));
  });

  it('[BM-026] [DR-SEC-01] isolates a multi-House Member shelf to the route House', async () => {
    const shelf = await repository.readMoveShelf(
      fakeAuthorizationContext({
        houseId: world.second.houseId,
        viewerId: world.switchingMember.userId,
      }),
    );

    expect(shelf).toEqual({
      yourMove: [
        {
          gameId: id(808),
          opponentName: 'Grace',
          moveDueAt: new Date('2026-09-07T08:00:00.000Z'),
          ply: 0,
        },
      ],
      waiting: [],
      recent: [],
    });
  });

  it('[BM-026] [DR-MEM-04] rejects a stale context after membership becomes inactive', async () => {
    await database.query(`update memberships set status = 'left', left_at = now() where id = $1`, [
      world.switchingMember.firstMembershipId,
    ]);

    await expect(
      repository.readMoveShelf(
        fakeAuthorizationContext({
          houseId: world.first.houseId,
          viewerId: world.switchingMember.userId,
        }),
      ),
    ).resolves.toBeNull();
  });

  it('[BM-026] [DR-HOUSE-04] does not expose Games after the House is deleted', async () => {
    await database.query(`update houses set status = 'deleted', deleted_at = now() where id = $1`, [
      world.first.houseId,
    ]);

    await expect(
      repository.readMoveShelf(
        fakeAuthorizationContext({
          houseId: world.first.houseId,
          viewerId: world.switchingMember.userId,
        }),
      ),
    ).resolves.toBeNull();
  });
});
