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

function parseUrl(name: string, value: string | undefined): string | undefined {
  const url = present(value);
  // The message leaves the value out because it holds a password.
  if (url !== undefined && !URL.canParse(url)) {
    throw new Error(
      `${name} is not a valid URL. Start the TLS test database with \`${testDatabaseSetupCommand}\`.`,
    );
  }
  return url;
}

function fromSettings(settings: Settings): TestDatabase | undefined {
  const url = parseUrl('TEST_DATABASE_URL', settings.TEST_DATABASE_URL);
  if (url === undefined) return undefined;
  return {
    url,
    runtimeUrl: parseUrl('TEST_RUNTIME_DATABASE_URL', settings.TEST_RUNTIME_DATABASE_URL),
  };
}

/**
 * The PostgreSQL that integration tests and e2e use: the environment when it sets
 * TEST_DATABASE_URL, otherwise the settings `pnpm db:test:up` saved. Throws when neither exists.
 */
export function requireTestDatabase(environment: Settings = process.env): TestDatabase {
  const database =
    fromSettings(environment) ??
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

/**
 * The DATABASE_URL the web app gets in e2e: the runtime role when `pnpm db:test:up` made one,
 * otherwise the test database owner. Throws when the environment sets DATABASE_URL to any other
 * value, so an e2e run cannot point the app at a developer's own database.
 */
export function requireE2eAppDatabaseUrl(environment: Settings = process.env): string {
  const database = requireTestDatabase(environment);
  const url = database.runtimeUrl ?? database.url;
  const configured = present(environment.DATABASE_URL);
  if (configured !== undefined && configured !== url) {
    throw new Error(
      'DATABASE_URL is set to a database other than the test database. E2E runs the app against the test database only. Unset DATABASE_URL and run again.',
    );
  }
  return url;
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
