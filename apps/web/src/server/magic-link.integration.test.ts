import {
  AesGcmMagicLinkDeliveryCodec,
  generateUuidV7,
  TestMagicLinkEmailSender,
} from '@between-moves/adapters';
import {
  createMagicLinkDeliveryQueue,
  createMagicLinkEmailConsumer,
  createOutboxDispatcher,
} from '@between-moves/application';
import {
  createDatabase,
  migrateDown,
  migrateUp,
  PgMagicLinkOutboxWriter,
  PgOutboxRepository,
} from '@between-moves/db';
import { FakeClock } from '@between-moves/domain/testing';
import { createDeliveryMetricStubs } from '@between-moves/observability';
import { betterAuth } from 'better-auth';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { createBetterAuthOptions } from './auth-options';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
const databaseUrl = testDatabaseUrl ?? 'postgresql://app:test@db.example.test/app?sslmode=require';
const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
);

integration('BM-008 magic-link full flow', () => {
  const database = createDatabase(databaseUrl);
  const clock = new FakeClock(new Date());
  const codec = new AesGcmMagicLinkDeliveryCodec(
    'integration-better-auth-secret-at-least-32-characters',
  );
  const queueMagicLink = createMagicLinkDeliveryQueue({
    clock,
    generateId: generateUuidV7,
    codec,
    writer: new PgMagicLinkOutboxWriter(database.pool),
  });
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
    APP_ENV: 'local',
  });
  const auth = betterAuth(
    createBetterAuthOptions({
      config,
      database: database.pool,
      logger: { log: vi.fn() },
      queueMagicLink,
    }),
  );
  const transport = new TestMagicLinkEmailSender();
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

  async function requestLink(email: string): Promise<string> {
    await auth.api.signInMagicLink({
      body: { email, name: 'Member', callbackURL: '/' },
      headers,
    });
    const persisted = await database.pool.query<{ payload: { sealed: string } }>(
      `select payload from outbox_events
        where topic = 'identity.magic-link-email.requested' and sent_at is null
        order by created_at desc limit 1`,
    );
    expect(JSON.stringify(persisted.rows)).not.toContain(email);
    expect(JSON.stringify(persisted.rows)).not.toContain('token=');
    await dispatcher.dispatchAvailable();
    const delivery = transport.deliveries().at(-1);
    if (!delivery) throw new Error('Expected test email delivery');
    return new URL(delivery.message.signInUrl).searchParams.get('token') ?? '';
  }

  it('[BM-008] [DR-ID-02..03] stores a digest, sends via outbox, and mints one session', async () => {
    const email = 'full-flow@example.test';
    const token = await requestLink(email);
    const verification = await database.pool.query<{
      identifier: string;
      expires_at: Date;
    }>('select identifier, expires_at from verification');

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(verification.rows[0]?.identifier).not.toBe(token);
    expect(verification.rows[0]?.identifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verification.rows[0]!.expires_at.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);

    const first = await auth.api.magicLinkVerify({
      query: { token, callbackURL: '/', errorCallbackURL: '/auth/link-invalid' },
      headers,
      asResponse: true,
    });
    const replay = await auth.api.magicLinkVerify({
      query: { token, callbackURL: '/', errorCallbackURL: '/auth/link-invalid' },
      headers,
      asResponse: true,
    });
    const state = await database.pool.query<{
      sessions: string;
      verifications: string;
      verified_at: Date | null;
    }>(
      `select
         (select count(*) from sessions)::text as sessions,
         (select count(*) from verification)::text as verifications,
         (select email_verified_at from users where email = $1) as verified_at`,
      [email],
    );

    expect(first.status).toBe(302);
    expect(first.headers.get('set-cookie')).toContain('__Secure-between-moves.session_token=');
    expect(replay.status).toBe(302);
    expect(replay.headers.get('set-cookie')).toBeNull();
    expect(state.rows[0]).toMatchObject({ sessions: '1', verifications: '0' });
    expect(state.rows[0]?.verified_at).toBeInstanceOf(Date);
  });

  it('[BM-008] rejects an expired token without creating a session', async () => {
    const token = await requestLink('expired-flow@example.test');
    await database.pool.query('update verification set expires_at = $1', [
      new Date(Date.now() - 1),
    ]);
    const before = await database.pool.query<{ count: string }>(
      'select count(*)::text as count from sessions',
    );

    const response = await auth.api.magicLinkVerify({
      query: { token, callbackURL: '/', errorCallbackURL: '/auth/link-invalid' },
      headers,
      asResponse: true,
    });
    const after = await database.pool.query<{ count: string }>(
      'select count(*)::text as count from sessions',
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/auth/link-invalid');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(after.rows).toEqual(before.rows);
  });
});
