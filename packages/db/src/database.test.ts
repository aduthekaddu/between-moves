import { describe, expect, it } from 'vitest';
import { assertTlsDatabaseUrl } from './database';

describe('database connection configuration', () => {
  it('[BM-004] accepts a PostgreSQL URL that requires TLS', () => {
    expect(() =>
      assertTlsDatabaseUrl('postgresql://app:test@db.example.test/app?sslmode=require'),
    ).not.toThrow();
  });

  it('[BM-004] rejects a non-TLS PostgreSQL URL with a generic error', () => {
    expect(() =>
      assertTlsDatabaseUrl('postgresql://app:do-not-log@db.example.test/app?sslmode=disable'),
    ).toThrow('DATABASE_URL must be a PostgreSQL URL with sslmode=require');
  });

  it('[BM-004] rejects a malformed URL without echoing credentials', () => {
    const malformed = 'postgresql://app:do-not-log@[';

    try {
      assertTlsDatabaseUrl(malformed);
      expect.unreachable('Expected malformed database URL to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        'DATABASE_URL must be a PostgreSQL URL with sslmode=require',
      );
      expect(JSON.stringify(error)).not.toContain('do-not-log');
    }
  });
});
