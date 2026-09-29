import type { QueueMagicLinkDelivery } from '@between-moves/application';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { createBetterAuthOptions } from './auth-options';
import { verifyMagicLinkPurpose } from './magic-link-purpose';

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
  UPSTASH_REDIS_REST_URL: 'https://rate-limit.example.test',
  UPSTASH_REDIS_REST_TOKEN: 'upstash-test-token',
  APP_ENV: 'preview',
});

describe('Better Auth magic-link configuration', () => {
  it('[BM-008] [BM-010] [DR-ID-03] configures flow-bound sign-in and recovery links', async () => {
    const queueMagicLink = vi.fn<QueueMagicLinkDelivery>(async () => undefined);
    const options = createBetterAuthOptions({
      config,
      database: {} as never,
      logger: { log: vi.fn() },
      queueMagicLink,
    });
    const plugin = options.plugins?.find((candidate) => candidate.id === 'magic-link');
    if (plugin?.options === undefined) throw new Error('Magic-link plugin is not configured');
    const pluginOptions = plugin.options as {
      expiresIn: number;
      storeToken: string;
      generateToken(email: string): Promise<string> | string;
      sendMagicLink(data: {
        email: string;
        url: string;
        token: string;
        metadata?: Record<string, unknown>;
      }): Promise<void> | void;
    };

    expect(pluginOptions).toMatchObject({ expiresIn: 15 * 60, storeToken: 'hashed' });
    const token = await pluginOptions.generateToken('member@example.test');
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);

    await pluginOptions.sendMagicLink({
      email: 'member@example.test',
      token,
      url: `https://preview.example.test/api/auth/magic-link/verify?token=${token}`,
    });
    const signInUrl = new URL(String(queueMagicLink.mock.calls[0]?.[0]?.signInUrl));
    const signInProof = signInUrl.searchParams.get('proof');
    expect(signInUrl.pathname).toBe('/api/auth/callback');
    expect(signInUrl.searchParams.get('token')).toBe(token);
    expect(verifyMagicLinkPurpose(config.betterAuthSecret, 'signin', token, signInProof)).toBe(
      true,
    );
    expect(verifyMagicLinkPurpose(config.betterAuthSecret, 'recovery', token, signInProof)).toBe(
      false,
    );

    const returnTo = `/invitations/${'A'.repeat(43)}`;
    await pluginOptions.sendMagicLink({
      email: 'member@example.test',
      token,
      url: `https://preview.example.test/api/auth/magic-link/verify?token=${token}`,
      metadata: { returnTo },
    });
    const invitationUrl = new URL(String(queueMagicLink.mock.calls[1]?.[0]?.signInUrl));
    expect(invitationUrl.pathname).toBe('/api/auth/callback');
    expect(invitationUrl.searchParams.get('returnTo')).toBe(returnTo);

    await pluginOptions.sendMagicLink({
      email: 'member@example.test',
      token,
      url: `https://preview.example.test/api/auth/magic-link/verify?token=${token}`,
      metadata: { flow: 'recovery' },
    });
    const recoveryUrl = new URL(String(queueMagicLink.mock.calls[2]?.[0]?.signInUrl));
    const recoveryProof = recoveryUrl.searchParams.get('proof');
    expect(recoveryUrl.pathname).toBe('/api/auth/recovery/callback');
    expect(recoveryUrl.searchParams.get('token')).toBe(token);
    expect(verifyMagicLinkPurpose(config.betterAuthSecret, 'recovery', token, recoveryProof)).toBe(
      true,
    );
    expect(verifyMagicLinkPurpose(config.betterAuthSecret, 'signin', token, recoveryProof)).toBe(
      false,
    );
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
