import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const seasonId = '01941f29-7c00-7000-8000-000000001001';
const gameId = '01941f29-7c00-7000-8000-000000001011';
const standardFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

integration('PostgreSQL Game records', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  let world: TwoHousesWithMembers;

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    world = await twoHousesWithMembers(database);
    const client = await database.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into seasons
          (id, house_id, title, state, starts_at, ends_at, published_charter_version)
         values ($1, $2, 'Game schema season', 'active', $3, $4, 1)`,
        [
          seasonId,
          world.first.houseId,
          new Date('2026-09-01T00:00:00.000Z'),
          new Date('2026-09-29T00:00:00.000Z'),
        ],
      );
      await client.query(
        `insert into season_charters
          (id, season_id, version, correspondence_pace_hours, night_recurrence,
           points_recipe, published_at)
         values ($1, $2, 1, 48, '{}', '{}', $3)`,
        ['01941f29-7c00-7000-8000-000000001002', seasonId, new Date('2026-09-01T00:00:00.000Z')],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    await database.query(
      `insert into games
        (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
         initial_fen, current_fen, clock_policy, move_due_at)
       values ($1, $2, $3, 'correspondence', 'active', $4, $5, $6, $6,
         '{"kind":"correspondence","perMoveHours":48}', $7)`,
      [
        gameId,
        world.first.houseId,
        seasonId,
        world.first.member.membershipId,
        world.first.nonOwner.membershipId,
        standardFen,
        new Date('2026-09-03T00:00:00.000Z'),
      ],
    );
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-021] [DR-MOVE-03] enforces unique Game ply and client command identifiers', async () => {
    await insertMove(database, {
      id: '01941f29-7c00-7000-8000-000000001021',
      ply: 1,
      commandId: '01941f29-7c00-7000-8000-000000001031',
    });

    await expect(
      insertMove(database, {
        id: '01941f29-7c00-7000-8000-000000001022',
        ply: 1,
        commandId: '01941f29-7c00-7000-8000-000000001032',
      }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'moves_game_ply_unique' });
    await expect(
      insertMove(database, {
        id: '01941f29-7c00-7000-8000-000000001023',
        ply: 2,
        commandId: '01941f29-7c00-7000-8000-000000001031',
      }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'moves_game_command_unique' });
    await expect(
      insertMove(database, {
        id: '01941f29-7c00-7000-8000-000000001024',
        ply: 2,
        commandId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'moves_client_command_uuid_v7_check',
    });
  });

  it('[BM-021] [DR-GAME-02] rejects mixed or invalid clock-policy shapes', async () => {
    await expect(
      insertWaitingGame(database, world, {
        id: '01941f29-7c00-7000-8000-000000001041',
        mode: 'correspondence',
        clockPolicy: { kind: 'correspondence', perMoveHours: 48, initialMs: 300_000 },
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'games_clock_policy_shape_check' });
    await expect(
      insertWaitingGame(database, world, {
        id: '01941f29-7c00-7000-8000-000000001042',
        mode: 'live',
        clockPolicy: { kind: 'live', initialMs: 120_000, incrementMs: 0 },
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'games_clock_policy_shape_check' });
    await expect(
      insertWaitingGame(database, world, {
        id: '01941f29-7c00-7000-8000-000000001046',
        mode: 'correspondence',
        clockPolicy: { perMoveHours: 48 },
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'games_clock_policy_shape_check' });
    await expect(
      insertWaitingGame(database, world, {
        id: '01941f29-7c00-7000-8000-000000001047',
        mode: 'live',
        clockPolicy: { kind: null, initialMs: 300_000, incrementMs: 0 },
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'games_clock_policy_shape_check' });
  });

  it('[BM-021] [DR-GAME-01] enforces House consistency for Games and Move actors', async () => {
    await expect(
      database.query(
        `insert into games
          (id, house_id, season_id, mode, state, white_membership_id,
           initial_fen, current_fen, clock_policy)
         values ($1, $2, $3, 'correspondence', 'waiting', $4, $5, $5,
           '{"kind":"correspondence","perMoveHours":48}')`,
        [
          '01941f29-7c00-7000-8000-000000001043',
          world.second.houseId,
          seasonId,
          world.second.member.membershipId,
          standardFen,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'games_season_house_fk' });
    await expect(
      database.query(
        `insert into moves
          (id, game_id, house_id, ply, actor_membership_id, uci, san, fen_after,
           client_command_id)
         values ($1, $2, $3, 1, $4, 'e2e4', 'e4', $5, $6)`,
        [
          '01941f29-7c00-7000-8000-000000001044',
          gameId,
          world.first.houseId,
          world.second.member.membershipId,
          'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
          '01941f29-7c00-7000-8000-000000001045',
        ],
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'moves_actor_house_fk' });
  });

  it('[BM-021] [DR-SEAT-03] enforces one open Open seat per waiting Game', async () => {
    const waitingGameId = '01941f29-7c00-7000-8000-000000001051';
    await insertWaitingGame(database, world, {
      id: waitingGameId,
      mode: 'correspondence',
      clockPolicy: { kind: 'correspondence', perMoveHours: 48 },
    });
    await database.query(
      `insert into open_seats
        (id, game_id, house_id, offered_color, creator_membership_id, state, expires_at)
       values ($1, $2, $3, 'black', $4, 'open', $5)`,
      [
        '01941f29-7c00-7000-8000-000000001052',
        waitingGameId,
        world.first.houseId,
        world.first.member.membershipId,
        new Date('2026-09-08T00:00:00.000Z'),
      ],
    );

    await expect(
      database.query(
        `insert into open_seats
          (id, game_id, house_id, offered_color, creator_membership_id, state, expires_at)
         values ($1, $2, $3, 'black', $4, 'open', $5)`,
        [
          '01941f29-7c00-7000-8000-000000001053',
          waitingGameId,
          world.first.houseId,
          world.first.member.membershipId,
          new Date('2026-09-08T00:00:00.000Z'),
        ],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'open_seats_one_open_per_game' });
  });

  it('[BM-021] [DR-REACT-01] [DR-NOTE-01] keeps one Reaction and note per Member and Game', async () => {
    await database.query(
      `update games
          set state = 'completed', result = 'draw', result_reason = 'agreement', completed_at = $2
        where id = $1`,
      [gameId, new Date('2026-09-02T00:00:00.000Z')],
    );
    await database.query(
      `insert into game_reactions (id, game_id, house_id, membership_id, reaction)
       values ($1, $2, $3, $4, 'well_played')`,
      [
        '01941f29-7c00-7000-8000-000000001061',
        gameId,
        world.first.houseId,
        world.first.member.membershipId,
      ],
    );
    await database.query(
      `insert into game_notes (id, game_id, house_id, membership_id, body)
       values ($1, $2, $3, $4, 'A memorable finish.')`,
      [
        '01941f29-7c00-7000-8000-000000001062',
        gameId,
        world.first.houseId,
        world.first.member.membershipId,
      ],
    );

    await expect(
      database.query(
        `insert into game_reactions (id, game_id, house_id, membership_id, reaction)
         values ($1, $2, $3, $4, 'dramatic')`,
        [
          '01941f29-7c00-7000-8000-000000001063',
          gameId,
          world.first.houseId,
          world.first.member.membershipId,
        ],
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'game_reactions_game_membership_unique',
    });
    await expect(
      database.query(
        `insert into game_notes (id, game_id, house_id, membership_id, body)
         values ($1, $2, $3, $4, 'A replacement note.')`,
        [
          '01941f29-7c00-7000-8000-000000001064',
          gameId,
          world.first.houseId,
          world.first.member.membershipId,
        ],
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'game_notes_game_membership_unique',
    });
    await expect(
      database.query(
        `insert into game_reactions (id, game_id, house_id, membership_id, reaction)
         values ($1, $2, $3, $4, 'unknown')`,
        [
          '01941f29-7c00-7000-8000-000000001065',
          gameId,
          world.first.houseId,
          world.first.nonOwner.membershipId,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'game_reactions_value_check' });
    await expect(
      database.query(
        `insert into game_notes (id, game_id, house_id, membership_id, body)
         values ($1, $2, $3, $4, $5)`,
        [
          '01941f29-7c00-7000-8000-000000001066',
          gameId,
          world.first.houseId,
          world.first.nonOwner.membershipId,
          'x'.repeat(2001),
        ],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'game_notes_body_check' });
  });
});

async function insertMove(
  database: Pool,
  input: { readonly id: string; readonly ply: number; readonly commandId: string },
): Promise<void> {
  await database.query(
    `insert into moves
      (id, game_id, house_id, ply, actor_membership_id, uci, san, fen_after, client_command_id)
     values ($1, $2, (select house_id from games where id = $2), $3,
       (select white_membership_id from games where id = $2), 'e2e4', 'e4', $4, $5)`,
    [
      input.id,
      gameId,
      input.ply,
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      input.commandId,
    ],
  );
}

async function insertWaitingGame(
  database: Pool,
  world: TwoHousesWithMembers,
  input: {
    readonly id: string;
    readonly mode: 'correspondence' | 'live';
    readonly clockPolicy: Readonly<Record<string, string | number | null>>;
  },
): Promise<void> {
  const liveClock = input.mode === 'live' ? 300_000 : null;
  await database.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, initial_fen, current_fen,
       clock_policy, white_clock_ms, black_clock_ms)
     values ($1, $2, $3, $4, 'waiting', $5, $6, $6, $7, $8, $8)`,
    [
      input.id,
      world.first.houseId,
      seasonId,
      input.mode,
      world.first.member.membershipId,
      standardFen,
      input.clockPolicy,
      liveClock,
    ],
  );
}
