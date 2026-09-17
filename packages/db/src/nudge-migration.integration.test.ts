import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';
import { twoHousesWithMembers, type TwoHousesWithMembers } from './testing';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const NOW = new Date('2026-09-15T12:00:00.000Z');

function id(suffix: number): string {
  return `01941f29-7c00-7000-8000-${String(suffix).padStart(12, '0')}`;
}

async function createVersionedGame(database: Pool, world: TwoHousesWithMembers): Promise<void> {
  await database.query(
    `insert into seasons (id, house_id, title, state, created_at, updated_at)
     values ($1, $2, 'Sequence migration', 'draft', $3, $3)`,
    [id(901), world.first.houseId, NOW],
  );
  await database.query(
    `insert into games
      (id, house_id, season_id, mode, state, white_membership_id, black_membership_id,
       current_ply, side_to_move, version, clock_policy, move_due_at, created_at)
     values ($1,$2,$3,'correspondence','active',$4,$5,7,'white',7,
             '{"kind":"correspondence","perMoveHours":48}',$6,$7)`,
    [
      id(902),
      world.first.houseId,
      id(901),
      world.first.member.membershipId,
      world.first.nonOwner.membershipId,
      new Date('2026-09-16T00:00:00.000Z'),
      NOW,
    ],
  );
}

integration('BM-029 Nudge migration', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });

  beforeEach(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
    // Roll back migrations newer than BM-029 so the fixture is inserted before
    // the nudge migration runs and its backfill is exercised.
    await migrateDown(database, { migrationsDirectory });
    await migrateDown(database, { migrationsDirectory });
    await migrateDown(database, { migrationsDirectory });
    await migrateDown(database, { migrationsDirectory });
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-029] backfills the aggregate sequence from Game version after outbox retention', async () => {
    const world = await twoHousesWithMembers(database);
    await createVersionedGame(database, world);

    await migrateUp(database, { migrationsDirectory });

    const game = await database.query<{ outbox_sequence: string }>(
      'select outbox_sequence::text from games where id = $1',
      [id(902)],
    );
    expect(game.rows).toEqual([{ outbox_sequence: '7' }]);
  });
});
