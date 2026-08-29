import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrations';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

integration('Identity session persistence', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });

  beforeAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-007] [DR-ID-04] persists a Better Auth-compatible user and active session', async () => {
    const userId = '01941f29-7c00-7000-8000-000000000101';
    const sessionId = '01941f29-7c00-7000-8000-000000000102';

    await database.query(
      `insert into users
        (id, display_name, email, email_verified, email_verified_at, image_url)
       values ($1, $2, $3, true, $4, $5)`,
      [
        userId,
        'Ada',
        'Ada@Example.test',
        new Date('2026-08-29T10:00:00.000Z'),
        'https://images.example.test/ada.png',
      ],
    );
    await database.query(
      `insert into sessions
        (id, user_id, token, expires_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId,
        userId,
        'opaque-database-session-token-000001',
        new Date('2026-09-05T10:00:00.000Z'),
        '192.0.2.1',
        'BM-007 integration test',
      ],
    );

    const result = await database.query<{
      display_name: string;
      email: string;
      token: string;
    }>(
      `select u.display_name, u.email::text, s.token
         from sessions s
         join users u on u.id = s.user_id
        where s.id = $1 and s.expires_at > $2 and s.revoked_at is null`,
      [sessionId, new Date('2026-08-30T10:00:00.000Z')],
    );

    expect(result.rows).toEqual([
      {
        display_name: 'Ada',
        email: 'Ada@Example.test',
        token: 'opaque-database-session-token-000001',
      },
    ]);
  });

  it('[BM-007] rejects an expired database session and cascades sessions on user deletion', async () => {
    const userId = '01941f29-7c00-7000-8000-000000000111';
    const sessionId = '01941f29-7c00-7000-8000-000000000112';

    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Grace', 'grace@example.test', true)`,
      [userId],
    );
    await database.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, 'expired-opaque-token-00000000000001', $3)`,
      [sessionId, userId, new Date('2026-08-28T10:00:00.000Z')],
    );

    const active = await database.query(
      `select id from sessions
        where id = $1 and expires_at > $2 and revoked_at is null`,
      [sessionId, new Date('2026-08-29T10:00:00.000Z')],
    );
    expect(active.rows).toEqual([]);

    await database.query('delete from users where id = $1', [userId]);
    const remaining = await database.query('select id from sessions where id = $1', [sessionId]);
    expect(remaining.rows).toEqual([]);
  });
});
