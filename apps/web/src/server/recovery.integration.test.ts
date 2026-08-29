import {
  AesGcmMagicLinkDeliveryCodec,
  generateUuidV7,
  TestMagicLinkEmailSender,
} from '@between-moves/adapters';
import {
  createCompleteAccountRecovery,
  createMagicLinkDeliveryQueue,
  createMagicLinkEmailConsumer,
  createOutboxDispatcher,
} from '@between-moves/application';
import {
  createDatabase,
  migrateDown,
  migrateUp,
  PgIdentityRecoveryRepository,
  PgMagicLinkOutboxWriter,
  PgOutboxRepository,
} from '@between-moves/db';
import { FakeClock } from '@between-moves/domain/testing';
import { createDeliveryMetricStubs } from '@between-moves/observability';
import { betterAuth } from 'better-auth';
import { makeSignature } from 'better-auth/crypto';
import { getCookies } from 'better-auth/cookies';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { createBetterAuthOptions } from './auth-options';
import { createBetterAuthSessionReader } from './better-auth-session-reader';
import { verifyMagicLinkPurpose } from './magic-link-purpose';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const databaseUrl = testDatabaseUrl ?? 'postgresql://app:test@db.example.test/app?sslmode=require';
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);

integration('BM-010 account recovery flow', () => {
  const database = createDatabase(databaseUrl);
  const clock = new FakeClock(new Date());
  const codec = new AesGcmMagicLinkDeliveryCodec(
    'integration-better-auth-secret-at-least-32-characters',
  );
  const transport = new TestMagicLinkEmailSender();
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
  const queueMagicLink = createMagicLinkDeliveryQueue({
    clock,
    generateId: generateUuidV7,
    codec,
    writer: new PgMagicLinkOutboxWriter(database.pool),
  });
  const options = createBetterAuthOptions({
    config,
    database: database.pool,
    logger: { log: vi.fn() },
    queueMagicLink,
  });
  const auth = betterAuth(options);
  const repository = new PgIdentityRecoveryRepository(database.pool);
  const dispatcher = createOutboxDispatcher({
    clock,
    repository: new PgOutboxRepository(database.pool),
    consumer: createMagicLinkEmailConsumer({ codec, sender: transport }),
    metrics: createDeliveryMetricStubs(),
  });
  const headers = new Headers({ origin: config.appOrigin.origin });

  beforeAll(async () => {
    await migrateDown(database.pool, { migrationsDirectory, all: true });
    await migrateUp(database.pool, { migrationsDirectory });
  });

  afterAll(async () => {
    await migrateDown(database.pool, { migrationsDirectory, all: true });
    await database.close();
  });

  async function sessionHeaders(token: string): Promise<Headers> {
    const signature = await makeSignature(token, config.betterAuthSecret);
    return new Headers({
      cookie: `${getCookies(options).sessionToken.name}=${token}.${signature}`,
    });
  }

  it('[BM-010] [DR-ID-02] keeps only the recovered session and rejects prior cookies', async () => {
    const context = await auth.$context;
    const userId = context.generateId({ model: 'user' });
    if (userId === false) throw new Error('Expected generated user ID');
    await context.internalAdapter.createUser(
      {
        id: userId,
        name: 'Ada',
        email: 'recovery-flow@example.test',
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { method: 'test' },
    );
    const priorSessions = await Promise.all([
      context.internalAdapter.createSession(userId),
      context.internalAdapter.createSession(userId),
    ]);

    await auth.api.signInMagicLink({
      body: {
        email: 'recovery-flow@example.test',
        callbackURL: '/',
        metadata: { flow: 'recovery' },
      },
      headers,
    });
    await dispatcher.dispatchAvailable();
    const delivery = transport.deliveries().at(-1);
    const recoveryUrl = new URL(delivery!.message.signInUrl);
    expect(recoveryUrl.pathname).toBe('/api/auth/recovery/callback');
    const token = recoveryUrl.searchParams.get('token');
    const proof = recoveryUrl.searchParams.get('proof');
    if (!token) throw new Error('Expected recovery token');
    expect(verifyMagicLinkPurpose(config.betterAuthSecret, 'recovery', token, proof)).toBe(true);
    expect(verifyMagicLinkPurpose(config.betterAuthSecret, 'signin', token, proof)).toBe(false);

    const verified = await auth.api.magicLinkVerify({
      query: { token, errorCallbackURL: '/auth/link-invalid' },
      headers,
      asResponse: true,
    });
    const payload = (await verified.json()) as {
      token: string;
      session: { id: string };
    };
    const completed = await createCompleteAccountRecovery({ sessions: repository, clock })(
      payload.token,
    );

    expect(completed).toEqual({ userId, revokedSessionCount: 2 });
    const reader = createBetterAuthSessionReader(auth, repository, { log: vi.fn() });
    for (const prior of priorSessions) {
      await expect(
        reader.read(
          new Request('https://integration.example.test/api/viewer', {
            headers: await sessionHeaders(prior.token),
          }),
        ),
      ).resolves.toBeNull();
    }
    await expect(
      reader.read(
        new Request('https://integration.example.test/api/viewer', {
          headers: await sessionHeaders(payload.token),
        }),
      ),
    ).resolves.toMatchObject({ userId });
    await expect(repository.isSessionActive(payload.session.id)).resolves.toBe(true);
  });
});
