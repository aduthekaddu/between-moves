import { describe, expect, it } from 'vitest';
import { requireE2eAppDatabaseUrl, requireTestDatabase } from './index';

const owner = 'postgresql://postgres:owner-pw@127.0.0.1:55432/between_moves_test?sslmode=require';
const runtime =
  'postgresql://between_moves_app:runtime-pw@127.0.0.1:55432/between_moves_test?sslmode=require';
const developerDatabase = 'postgresql://dev:dev-pw@db.example.test:5432/between_moves_dev';

describe('requireE2eAppDatabaseUrl', () => {
  it('gives the app the runtime role of the test database', () => {
    expect(
      requireE2eAppDatabaseUrl({ TEST_DATABASE_URL: owner, TEST_RUNTIME_DATABASE_URL: runtime }),
    ).toBe(runtime);
  });

  it('falls back to the test database owner when there is no runtime role', () => {
    expect(requireE2eAppDatabaseUrl({ TEST_DATABASE_URL: owner })).toBe(owner);
  });

  it('refuses a DATABASE_URL that points anywhere but the test database', () => {
    expect(() =>
      requireE2eAppDatabaseUrl({
        TEST_DATABASE_URL: owner,
        TEST_RUNTIME_DATABASE_URL: runtime,
        DATABASE_URL: developerDatabase,
      }),
    ).toThrow(/DATABASE_URL is set to a database other than the test database/);
  });

  it('accepts a DATABASE_URL that already names the test database', () => {
    expect(
      requireE2eAppDatabaseUrl({
        TEST_DATABASE_URL: owner,
        TEST_RUNTIME_DATABASE_URL: runtime,
        DATABASE_URL: runtime,
      }),
    ).toBe(runtime);
  });
});

describe('requireTestDatabase', () => {
  it('names the setup command, not the value, when TEST_DATABASE_URL is malformed', () => {
    expect(() => requireTestDatabase({ TEST_DATABASE_URL: 'not a url owner-pw' })).toThrow(
      'TEST_DATABASE_URL is not a valid URL. Start the TLS test database with `pnpm db:test:up`.',
    );
  });
});
