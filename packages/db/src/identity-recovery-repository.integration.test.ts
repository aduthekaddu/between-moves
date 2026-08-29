import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgIdentityRecoveryRepository } from './identity-recovery-repository';
import { migrateDown, migrateUp } from './migrations';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(new URL('../migrations', import.meta.url));

integration('BM-010 identity recovery repository', () => {
  const database = new Pool({ connectionString: testDatabaseUrl });
  const repository = new PgIdentityRecoveryRepository(database);

  beforeAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await migrateUp(database, { migrationsDirectory });
  });

  afterAll(async () => {
    await migrateDown(database, { migrationsDirectory, all: true });
    await database.end();
  });

  it('[BM-010] [DR-ID-02] revokes all prior sessions and preserves only the recovered session', async () => {
    const userId = '01941f29-7c00-7000-8000-000000000301';
    const sessionIds = [
      '01941f29-7c00-7000-8000-000000000302',
      '01941f29-7c00-7000-8000-000000000303',
      '01941f29-7c00-7000-8000-000000000304',
    ];
    const tokens = sessionIds.map((_, index) => `recovery-session-token-${index}`.padEnd(32, 'x'));
    await database.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Ada', 'recovery@example.test', true)`,
      [userId],
    );
    for (let index = 0; index < sessionIds.length; index += 1) {
      await database.query(
        `insert into sessions (id, user_id, token, expires_at)
         values ($1, $2, $3, $4)`,
        [sessionIds[index], userId, tokens[index], new Date('2026-09-05T00:00:00.000Z')],
      );
    }

    const result = await repository.revokePriorSessions(
      tokens[2]!,
      new Date('2026-08-29T18:00:00.000Z'),
    );
    const persisted = await database.query<{ id: string; revoked_at: Date | null }>(
      'select id::text, revoked_at from sessions where user_id = $1 order by id',
      [userId],
    );

    expect(result).toEqual({ userId, revokedSessionCount: 2 });
    expect(persisted.rows.map((row) => [row.id, row.revoked_at !== null])).toEqual([
      [sessionIds[0], true],
      [sessionIds[1], true],
      [sessionIds[2], false],
    ]);
    await expect(repository.isSessionActive(sessionIds[0]!)).resolves.toBe(false);
    await expect(repository.isSessionActive(sessionIds[2]!)).resolves.toBe(true);

    await repository.revokeSession(tokens[2]!, new Date('2026-08-29T18:01:00.000Z'));
    await expect(repository.isSessionActive(sessionIds[2]!)).resolves.toBe(false);
  });

  it('[BM-010] treats deleted or unknown accounts as ineligible for recovery', async () => {
    expect(await repository.hasActiveAccount('recovery@example.test')).toBe(true);
    expect(await repository.hasActiveAccount('unknown@example.test')).toBe(false);
    await database.query(
      `update users set status = 'deleted', deleted_at = now()
        where email = 'recovery@example.test'`,
    );
    expect(await repository.hasActiveAccount('recovery@example.test')).toBe(false);
  });
});
