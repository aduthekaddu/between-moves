import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

const MIGRATION_TABLE = 'between_moves_migrations';
const LOCK_KEY = 724_004;

export interface MigrationOptions {
  readonly migrationsDirectory: string;
  readonly all?: boolean;
}

interface Migration {
  readonly name: string;
  readonly up: string;
  readonly down: string;
}

async function readMigrations(directory: string): Promise<readonly Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}_[a-z0-9_]+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      name,
      up: await readFile(join(directory, name, 'up.sql'), 'utf8'),
      down: await readFile(join(directory, name, 'down.sql'), 'utf8'),
    })),
  );
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    create table if not exists ${MIGRATION_TABLE} (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function inTransaction(client: PoolClient, operation: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await operation();
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function withMigrationLock<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureMigrationTable(client);
    return await operation(client);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    client.release();
  }
}

/** [BM-004] Apply each pending, hand-reviewed migration exactly once. */
export async function migrateUp(pool: Pool, options: MigrationOptions): Promise<string[]> {
  const migrations = await readMigrations(options.migrationsDirectory);
  return withMigrationLock(pool, async (client) => {
    const result = await client.query<{ name: string }>(`select name from ${MIGRATION_TABLE}`);
    const applied = new Set(result.rows.map((row) => row.name));
    const pending = migrations.filter((migration) => !applied.has(migration.name));

    for (const migration of pending) {
      await inTransaction(client, async () => {
        await client.query(migration.up);
        await client.query(`insert into ${MIGRATION_TABLE} (name) values ($1)`, [migration.name]);
      });
    }
    return pending.map((migration) => migration.name);
  });
}

/** [BM-004] Reverse the latest migration (or all migrations) in non-production workflows. */
export async function migrateDown(pool: Pool, options: MigrationOptions): Promise<string[]> {
  const migrations = await readMigrations(options.migrationsDirectory);
  const byName = new Map(migrations.map((migration) => [migration.name, migration]));

  return withMigrationLock(pool, async (client) => {
    const result = await client.query<{ name: string }>(
      `select name from ${MIGRATION_TABLE} order by name desc`,
    );
    const selected = options.all ? result.rows : result.rows.slice(0, 1);

    for (const row of selected) {
      const migration = byName.get(row.name);
      if (!migration) throw new Error(`Applied migration is unavailable: ${row.name}`);
      await inTransaction(client, async () => {
        await client.query(migration.down);
        await client.query(`delete from ${MIGRATION_TABLE} where name = $1`, [migration.name]);
      });
    }
    return selected.map((row) => row.name);
  });
}
