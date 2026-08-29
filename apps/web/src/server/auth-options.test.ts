import type { StructuredLogger } from '@between-moves/observability';
import { getCookies } from 'better-auth/cookies';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { createBetterAuthOptions } from './auth-options';

const config = loadConfig({
  DATABASE_URL: 'postgresql://app:test@db.example.test/app?sslmode=require',
  BETTER_AUTH_SECRET: 'better-auth-secret-with-at-least-32-characters',
  APP_ORIGIN: 'https://preview.example.test',
  RESEND_API_KEY: 're_test_key',
  RESEND_WEBHOOK_SECRET: 'whsec_test_secret',
  REALTIME_APP_ID: 'realtime-test-app',
  REALTIME_SERVER_KEY: 'realtime-test-server-key',
  REALTIME_PUBLIC_KEY: 'realtime-test-public-key',
  ANALYSIS_WORKER_URL: 'https://worker.example.test',
  ANALYSIS_WORKER_SECRET: 'analysis-test-secret',
  APP_ENV: 'preview',
});

describe('Better Auth configuration', () => {
  it('[BM-007] [DR-ID-02] maps Better Auth to the reviewed users and sessions schema', () => {
    const options = createBetterAuthOptions({
      config,
      database: {} as never,
      logger: { log: vi.fn() },
      queueMagicLink: vi.fn(),
    });

    expect(options.database).toBeDefined();
    expect(options.user).toMatchObject({
      modelName: 'users',
      fields: {
        name: 'display_name',
        emailVerified: 'email_verified',
        image: 'image_url',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    });
    expect(options.session).toMatchObject({
      modelName: 'sessions',
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    });
  });

  it('[BM-007] [DR-ID-02] forces Secure, HttpOnly, SameSite=Lax opaque session cookies', () => {
    const options = createBetterAuthOptions({
      config,
      database: {} as never,
      logger: { log: vi.fn() },
      queueMagicLink: vi.fn(),
    });

    expect(options.advanced).toMatchObject({
      useSecureCookies: true,
      defaultCookieAttributes: {
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
    });
    expect(options.session).toMatchObject({ cookieCache: { enabled: false } });

    const sessionCookie = getCookies(options).sessionToken;
    expect(sessionCookie.name).toBe('__Secure-between-moves.session_token');
    expect(sessionCookie.attributes).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('[BM-007] [DR-SEC-06] observes session creation by actor id without logging its token', async () => {
    const log = vi.fn<StructuredLogger['log']>();
    const options = createBetterAuthOptions({
      config,
      database: {} as never,
      logger: { log },
      queueMagicLink: vi.fn(),
    });
    const afterCreate = options.databaseHooks?.session?.create?.after;

    await afterCreate?.(
      {
        id: '01941f29-7c00-7000-8000-000000000002',
        userId: '01941f29-7c00-7000-8000-000000000001',
        token: 'must-never-be-logged',
        expiresAt: new Date('2026-09-05T00:00:00.000Z'),
        createdAt: new Date('2026-08-29T00:00:00.000Z'),
        updatedAt: new Date('2026-08-29T00:00:00.000Z'),
      },
    );

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: '01941f29-7c00-7000-8000-000000000001',
        event: 'identity.session.created',
        outcome: 'success',
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('must-never-be-logged');
  });
});
