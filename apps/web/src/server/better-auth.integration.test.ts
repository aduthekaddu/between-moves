import { createDatabase, migrateDown, migrateUp } from '@between-moves/db';
import { betterAuth } from 'better-auth';
import { makeSignature } from 'better-auth/crypto';
import { getCookies } from 'better-auth/cookies';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { createBetterAuthOptions } from './auth-options';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseUrl = testDatabaseUrl ?? 'postgresql://app:test@db.example.test/app?sslmode=require';
const integration = testDatabaseUrl ? describe : describe.skip;
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);

integration('Better Auth PostgreSQL sessions', () => {
  const database = createDatabase(databaseUrl);
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'integration-better-auth-secret-at-least-32-characters',
    APP_ORIGIN: 'https://integration.example.test',
    RESEND_API_KEY: 're_integration_key',
    RESEND_WEBHOOK_SECRET: 'whsec_integration_secret',
    REALTIME_APP_ID: 'realtime-integration-app',
    REALTIME_SERVER_KEY: 'realtime-integration-server-key',
    REALTIME_PUBLIC_KEY: 'realtime-integration-public-key',
    ANALYSIS_WORKER_URL: 'https://worker.integration.example.test',
    ANALYSIS_WORKER_SECRET: 'analysis-integration-secret',
    UPSTASH_REDIS_REST_URL: 'https://rate-limit.integration.example.test',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-integration-token',
    APP_ENV: 'local',
  });
  const options = createBetterAuthOptions({
    config,
    database: database.pool,
    logger: { log: vi.fn() },
    queueMagicLink: vi.fn(),
  });
  const createAuth = () => betterAuth(options);
  // Built after migrateUp: Better Auth checks the schema once at construction and keeps a mismatch.
  let auth: ReturnType<typeof createAuth>;

  beforeAll(async () => {
    await migrateDown(database.pool, { migrationsDirectory, all: true });
    await migrateUp(database.pool, { migrationsDirectory });
    auth = createAuth();
  });

  afterAll(async () => {
    await migrateDown(database.pool, { migrationsDirectory, all: true });
    await database.close();
  });

  async function sessionHeaders(token: string): Promise<Headers> {
    const signature = await makeSignature(token, config.betterAuthSecret);
    const cookie = getCookies(options).sessionToken;
    return new Headers({ cookie: `${cookie.name}=${token}.${signature}` });
  }

  it('[BM-007] creates and validates a persisted session through Better Auth', async () => {
    const context = await auth.$context;
    const userId = context.generateId({ model: 'user' });
    if (userId === false) throw new Error('Better Auth must generate identity IDs');

    const savedUser = await context.internalAdapter.createUser(
      {
        id: userId,
        name: 'Ada',
        email: 'ada-auth@example.test',
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { method: 'test' },
    );
    const session = await context.internalAdapter.createSession(savedUser.id);
    const headers = await sessionHeaders(session.token);

    const result = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
    const persisted = await database.pool.query<{
      user_id: string;
      session_id: string;
      token: string;
    }>(
      `select u.id::text as user_id, s.id::text as session_id, s.token
         from users u join sessions s on s.user_id = u.id
        where u.id = $1`,
      [savedUser.id],
    );

    expect(savedUser.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(getCookies(options).sessionToken).toMatchObject({
      name: '__Secure-between-moves.session_token',
      attributes: { httpOnly: true, secure: true, sameSite: 'lax' },
    });
    expect(result).toMatchObject({
      user: { id: savedUser.id, name: 'Ada', email: 'ada-auth@example.test' },
      session: { id: session.id, userId: savedUser.id },
    });
    expect(persisted.rows).toEqual([
      {
        user_id: savedUser.id,
        session_id: session.id,
        token: session.token,
      },
    ]);
  });

  it('[BM-007] rejects an expired persisted session', async () => {
    const userId = '01941f29-7c00-7000-8000-000000000211';
    const sessionId = '01941f29-7c00-7000-8000-000000000212';
    const token = 'expired-opaque-session-token-00001';

    await database.pool.query(
      `insert into users (id, display_name, email, email_verified)
       values ($1, 'Grace', 'grace-auth@example.test', true)`,
      [userId],
    );
    await database.pool.query(
      `insert into sessions (id, user_id, token, expires_at)
       values ($1, $2, $3, $4)`,
      [sessionId, userId, token, new Date(Date.now() - 60_000)],
    );

    await expect(
      auth.api.getSession({
        headers: await sessionHeaders(token),
        query: { disableCookieCache: true },
      }),
    ).resolves.toBeNull();
  });
});
