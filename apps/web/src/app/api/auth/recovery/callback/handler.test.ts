import { describe, expect, it, vi } from 'vitest';
import { createRecoveryCallbackHandler } from './handler';

const callback =
  'https://app.example.test/api/auth/recovery/callback?token=magic-secret&proof=recovery-proof';

describe('GET /api/auth/recovery/callback', () => {
  it('[BM-010] [DR-ID-02] revokes prior sessions before returning the recovered cookie', async () => {
    const completeRecovery = vi.fn(async () => ({
      userId: '01941f29-7c00-7000-8000-000000000001',
      revokedSessionCount: 2,
    }));
    const onCompleted = vi.fn();
    const isExpectedPurpose = vi.fn(() => true);
    const handler = createRecoveryCallbackHandler({
      isExpectedPurpose,
      verifyMagicLink: vi.fn(async () => ({
        sessionToken: 'new-session-secret',
        cookies: ['__Secure-between-moves.session_token=signed-new-session; Secure; HttpOnly'],
      })),
      completeRecovery,
      discardRecoverySession: vi.fn(),
      onCompleted,
      onFailed: vi.fn(),
    });

    const response = await handler(new Request(callback));

    expect(isExpectedPurpose).toHaveBeenCalledWith('magic-secret', 'recovery-proof');
    expect(completeRecovery).toHaveBeenCalledWith('new-session-secret');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://app.example.test/account');
    expect(response.headers.get('set-cookie')).toContain('signed-new-session');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(onCompleted).toHaveBeenCalledWith({
      userId: '01941f29-7c00-7000-8000-000000000001',
      revokedSessionCount: 2,
    });
    expect(JSON.stringify(onCompleted.mock.calls)).not.toContain('new-session-secret');
    expect(JSON.stringify(onCompleted.mock.calls)).not.toContain('magic-secret');
  });

  it('[BM-010] handles invalid links and revocation failures with the same generic redirect', async () => {
    const invalid = createRecoveryCallbackHandler({
      isExpectedPurpose: vi.fn(() => true),
      verifyMagicLink: vi.fn(async () => null),
      completeRecovery: vi.fn(),
      discardRecoverySession: vi.fn(),
      onCompleted: vi.fn(),
      onFailed: vi.fn(),
    });
    const discardRecoverySession = vi.fn(async () => undefined);
    const failed = createRecoveryCallbackHandler({
      isExpectedPurpose: vi.fn(() => true),
      verifyMagicLink: vi.fn(async () => ({
        sessionToken: 'unpublished-session-secret',
        cookies: ['session=must-not-be-forwarded'],
      })),
      completeRecovery: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
      discardRecoverySession,
      onCompleted: vi.fn(),
      onFailed: vi.fn(),
    });

    for (const handler of [invalid, failed]) {
      const response = await handler(new Request(callback));
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://app.example.test/auth/link-invalid');
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect(discardRecoverySession).toHaveBeenCalledWith('unpublished-session-secret');
  });

  it('[BM-010] rejects a sign-in-purpose token before provider verification', async () => {
    const verifyMagicLink = vi.fn();
    const onFailed = vi.fn();
    const handler = createRecoveryCallbackHandler({
      isExpectedPurpose: vi.fn(() => false),
      verifyMagicLink,
      completeRecovery: vi.fn(),
      discardRecoverySession: vi.fn(),
      onCompleted: vi.fn(),
      onFailed,
    });

    const response = await handler(new Request(callback));

    expect(response.headers.get('location')).toBe('https://app.example.test/auth/link-invalid');
    expect(verifyMagicLink).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledOnce();
  });
});
