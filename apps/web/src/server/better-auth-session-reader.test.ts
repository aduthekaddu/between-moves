import type { StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createBetterAuthSessionReader } from './better-auth-session-reader';

describe('Better Auth session reader', () => {
  it('[BM-007] [DR-ID-01] maps a validated Better Auth session to session identity', async () => {
    const getSession = vi.fn().mockResolvedValue({
      user: {
        id: '01941f29-7c00-7000-8000-000000000001',
        name: 'Ada',
        image: null,
      },
      session: { expiresAt: new Date('2026-09-05T00:00:00.000Z') },
    });
    const log = vi.fn<StructuredLogger['log']>();
    const reader = createBetterAuthSessionReader({ api: { getSession } }, { log });
    const request = new Request('https://betweenmoves.example.test/private', {
      headers: {
        cookie: 'between-moves.session_token=opaque-secret-token',
        'x-request-id': 'request-123',
      },
    });

    await expect(reader.read(request)).resolves.toEqual({
      userId: '01941f29-7c00-7000-8000-000000000001',
      displayName: 'Ada',
      imageUrl: null,
    });
    expect(getSession).toHaveBeenCalledWith({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-123',
        actorId: '01941f29-7c00-7000-8000-000000000001',
        event: 'identity.session.resolved',
        outcome: 'success',
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('opaque-secret-token');
  });

  it('[BM-007] resolves an invalid or expired Better Auth session anonymously', async () => {
    const getSession = vi.fn().mockResolvedValue(null);
    const log = vi.fn<StructuredLogger['log']>();
    const reader = createBetterAuthSessionReader({ api: { getSession } }, { log });

    await expect(
      reader.read(new Request('https://betweenmoves.example.test/private')),
    ).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'anonymous',
        event: 'identity.session.resolved',
        outcome: 'rejected',
      }),
    );
  });
});
