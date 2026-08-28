import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

integration('PostgreSQL foundation', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });

  beforeAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-004] applies and records the first migration on a fresh PostgreSQL 16+ database', async () => {
    const applied = await migrateUp(database, { migrationsDirectory });
    const version = await database.query<{ server_version_num: string }>(
      "select current_setting('server_version_num') as server_version_num",
    );
    const records = await database.query<{ name: string }>(
      'select name from between_moves_migrations order by name',
    );
    const helper = await database.query<{ is_uuid_v7: boolean }>(
      "select is_uuid_v7('01941f29-7c00-7000-8000-000000000000'::uuid) as is_uuid_v7",
    );

    expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(160_000);
    expect(applied).toEqual(['0000_database_foundation']);
    expect(records.rows).toEqual([{ name: '0000_database_foundation' }]);
    expect(helper.rows).toEqual([{ is_uuid_v7: true }]);
  });

  it('[BM-004] executes a parameterized round-trip query on the CI database', async () => {
    const result = await database.query<{ value: string }>('select $1::text as value', [
      'between-moves',
    ]);

    expect(result.rows).toEqual([{ value: 'between-moves' }]);
  });

  it('[BM-004] reverses the latest migration in test and development databases', async () => {
    const reverted = await migrateDown(database, { migrationsDirectory });
    const helper = await database.query<{ helper: string | null }>(
      "select to_regprocedure('is_uuid_v7(uuid)')::text as helper",
    );

    expect(reverted).toEqual(['0000_database_foundation']);
    expect(helper.rows).toEqual([{ helper: null }]);
  });
});
