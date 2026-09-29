import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { PgGamePositionRepository } from './pg-game-position-repository';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

integration('PostgreSQL Game position query', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const repository = new PgGamePositionRepository(database);
  let world: TwoHousesWithMembers;
  const seasonId = id(901);
  const gameId = id(902);
  const afterE4Fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    await database.query(
      `insert into seasons (id, house_id, title, state, created_at, updated_at)
       values ($1, $2, 'Board season', 'draft', $3, $3)`,
      [seasonId, world.first.houseId, new Date('2026-09-01T08:00:00.000Z')],
    );
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         side_to_move, clock_policy, move_due_at, created_at)
       values ($1, $2, $3, 'correspondence', 'active', $4, $5, 'white',
               '{"kind":"correspondence","perMoveHours":48}', $6, $7)`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        new Date('2026-09-10T08:00:00.000Z'),
        new Date('2026-09-01T08:00:00.000Z'),
      ],
    );
    await database.query(
      `insert into moves
        (id, game_id, house_id, ply, actor_membership_id, uci, san, fen_after,
         client_command_id, accepted_version, server_received_at)
       values ($1, $2, $3, 1, $4, 'e2e4', 'e4', $5, $6, 1, $7)`,
      [
        id(903),
        gameId,
        world.first.houseId,
        world.first.member.membershipId,
        afterE4Fen,
        id(904),
        new Date('2026-09-02T08:00:00.000Z'),
      ],
    );
    await database.query(
      `update games
          set current_fen = $2, current_ply = 1, side_to_move = 'black', version = 1
        where id = $1`,
      [gameId, afterE4Fen],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-027] reads the canonical board, seats, turn, and SAN history', async () => {
    const position = await repository.readGamePosition(
      fakeAuthorizationContext({
        houseId: world.first.houseId,
        viewerId: world.first.member.userId,
      }),
      gameId,
    );

    expect(position).toMatchObject({
      gameId,
      mode: 'correspondence',
      state: 'active',
      currentFen: afterE4Fen,
      currentPly: 1,
      sideToMove: 'black',
      version: 1,
      white: { membershipId: world.first.member.membershipId, name: 'Ada' },
      black: { membershipId: world.first.nonOwner.membershipId, name: 'Bea' },
      viewerColor: 'white',
      canMove: false,
      result: null,
      inCheck: false,
      moves: [{ ply: 1, uci: 'e2e4', san: 'e4' }],
      pendingDrawOffer: null,
    });
  });

  it('[BM-028] [DR-DRAW-02] reads the pending draw offer so the opponent can answer it', async () => {
    // White offered after e4; it is Black's turn to accept or play on.
    await database.query(
      `update games set draw_offer_membership_id = $2, draw_offer_ply = 1 where id = $1`,
      [gameId, world.first.member.membershipId],
    );

    await expect(
      repository.readGamePosition(
        fakeAuthorizationContext({
          houseId: world.first.houseId,
          viewerId: world.first.nonOwner.userId,
        }),
        gameId,
      ),
    ).resolves.toMatchObject({
      viewerColor: 'black',
      canMove: true,
      pendingDrawOffer: { offeringMembershipId: world.first.member.membershipId, ply: 1 },
    });
  });

  it('[BM-041] reads both server clocks and the active turn timestamp', async () => {
    const started = new Date('2026-09-02T09:00:10.000Z');
    await database.query(
      `update games set mode='live', clock_policy=$2, white_clock_ms=292000,
        black_clock_ms=300000, turn_started_at=$3, move_due_at=null where id=$1`,
      [gameId, { kind: 'live', initialMs: 300_000, incrementMs: 2_000 }, started],
    );
    await expect(
      repository.readGamePosition(
        fakeAuthorizationContext({
          houseId: world.first.houseId,
          viewerId: world.first.member.userId,
        }),
        gameId,
      ),
    ).resolves.toMatchObject({
      liveClock: {
        whiteMs: 292_000,
        blackMs: 300_000,
        turnStartedAt: started,
      },
    });
  });

  it('[BM-027] [DR-SEC-01] hides cross-House and inactive-membership reads', async () => {
    await expect(
      repository.readGamePosition(
        fakeAuthorizationContext({
          houseId: world.second.houseId,
          viewerId: world.first.member.userId,
        }),
        gameId,
      ),
    ).resolves.toBeNull();

    await database.query(`update memberships set status = 'left', left_at = now() where id = $1`, [
      world.first.nonOwner.membershipId,
    ]);
    await expect(
      repository.readGamePosition(
        fakeAuthorizationContext({
          houseId: world.first.houseId,
          viewerId: world.first.nonOwner.userId,
        }),
        gameId,
      ),
    ).resolves.toBeNull();
  });
});
