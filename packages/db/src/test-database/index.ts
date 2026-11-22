import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { Pool } from 'pg';
import { migrateUp } from '../migrations';

export const testDatabaseSetupCommand = 'pnpm db:test:up';

const settingsFile = fileURLToPath(new URL('../../../../.test-database/env', import.meta.url));
const migrationsDirectory = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface TestDatabase {
  /** Owner of the schema. Tests, fixtures and migrations connect with it. */
  readonly url: string;
  /** Least-privilege role the web app uses in e2e, when the database came from `pnpm db:test:up`. */
  readonly runtimeUrl: string | undefined;
}

type Settings = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function fromSettings(settings: Settings): TestDatabase | undefined {
  const url = present(settings.TEST_DATABASE_URL);
  if (url === undefined) return undefined;
  return { url, runtimeUrl: present(settings.TEST_RUNTIME_DATABASE_URL) };
}

/**
 * The PostgreSQL that integration tests and e2e use: the environment when it sets
 * TEST_DATABASE_URL, otherwise the settings `pnpm db:test:up` saved. Throws when neither exists.
 */
export function requireTestDatabase(): TestDatabase {
  const database =
    fromSettings(process.env) ??
    (existsSync(settingsFile)
      ? fromSettings(parseEnv(readFileSync(settingsFile, 'utf8')))
      : undefined);
  if (database === undefined) {
    throw new Error(
      `Integration tests need PostgreSQL and TEST_DATABASE_URL is unset. Start the TLS test database with \`${testDatabaseSetupCommand}\`.`,
    );
  }
  return database;
}

export function requireTestDatabaseUrl(): string {
  return requireTestDatabase().url;
}

/** Runs once before integration tests or e2e are collected, so a missing database fails the run. */
export async function assertTestDatabaseReachable(): Promise<void> {
  const { url } = requireTestDatabase();
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5_000 });
  try {
    await pool.query('select 1');
  } catch (error) {
    const { host, pathname } = new URL(url);
    throw new Error(
      `Integration tests cannot reach PostgreSQL at ${host}${pathname}. Start the TLS test database with \`${testDatabaseSetupCommand}\`.`,
      { cause: error },
    );
  } finally {
    await pool.end();
  }
}

/** Applies every pending migration, so e2e starts from the reviewed schema. */
export async function migrateTestDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 1 });
  try {
    await migrateUp(pool, { migrationsDirectory });
  } finally {
    await pool.end();
  }
}
