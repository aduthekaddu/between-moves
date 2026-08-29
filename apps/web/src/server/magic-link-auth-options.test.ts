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

describe('Better Auth magic-link configuration', () => {
  it('[BM-008] [PR-PLAT-04] [DR-ID-03] configures the sole sign-in plugin safely', async () => {
    const queueMagicLink = vi.fn(async () => undefined);
    const options = createBetterAuthOptions({
      config,
      database: {} as never,
      logger: { log: vi.fn() },
      queueMagicLink,
    });
    const plugin = options.plugins?.find((candidate) => candidate.id === 'magic-link');
    const pluginOptions = plugin?.options as {
      expiresIn: number;
      storeToken: string;
      generateToken(email: string): Promise<string> | string;
      sendMagicLink(data: { email: string; url: string; token: string }): Promise<void> | void;
    };

    expect(pluginOptions).toMatchObject({ expiresIn: 15 * 60, storeToken: 'hashed' });
    const token = await pluginOptions.generateToken('member@example.test');
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);

    await pluginOptions.sendMagicLink({
      email: 'member@example.test',
      token,
      url: `https://preview.example.test/api/auth/magic-link/verify?token=${token}`,
    });
    expect(queueMagicLink).toHaveBeenCalledWith({
      email: 'member@example.test',
      signInUrl: `https://preview.example.test/api/auth/callback?token=${encodeURIComponent(token)}`,
    });
  });

  it('[BM-008] maps Better Auth-owned account and verification fields to reviewed tables', () => {
    const options = createBetterAuthOptions({
      config,
      database: {} as never,
      logger: { log: vi.fn() },
      queueMagicLink: vi.fn(),
    });

    expect(options.account).toMatchObject({
      modelName: 'accounts',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    });
    expect(options.verification).toMatchObject({
      modelName: 'verification',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    });
  });
});
