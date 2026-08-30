import type { RateLimitInput, RateLimiter } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createInvitationRateLimit } from './invitation-rate-limit';

describe('Invitation rate limits', () => {
  it('[BM-014] [DR-INVITE-13] applies creation limits to opaque account and IP keys', async () => {
    const seen: RateLimitInput[] = [];
    const primary: RateLimiter = {
      async limit(input) {
        seen.push(input);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    };
    const limit = createInvitationRateLimit({
      primary,
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });

    await expect(
      limit(
        new Request('https://app.example.test', {
          headers: { 'x-forwarded-for': '203.0.113.42' },
        }),
        '01941f29-7c00-7000-8000-000000000101',
        'create',
      ),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(seen.map(({ policy }) => policy)).toEqual([
      { limit: 20, windowSeconds: 3600 },
      { limit: 40, windowSeconds: 3600 },
    ]);
    expect(JSON.stringify(seen)).not.toContain('203.0.113.42');
    expect(JSON.stringify(seen)).not.toContain('01941f29-7c00-7000-8000-000000000101');
  });

  it('[BM-014] [DR-INVITE-13] fails open on a store error but preserves a fulfilled denial', async () => {
    let call = 0;
    const incrementRateLimitHit = vi.fn();
    const onStoreError = vi.fn();
    const limit = createInvitationRateLimit({
      primary: {
        async limit() {
          call += 1;
          if (call === 1) throw new Error('store down');
          return { allowed: false, retryAfterSeconds: 17 };
        },
      },
      incrementRateLimitHit,
      onStoreError,
    });

    await expect(
      limit(new Request('https://app.example.test'), 'viewer-id', 'inspect'),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 17 });
    expect(onStoreError).toHaveBeenCalledWith('inspect');
    expect(incrementRateLimitHit).toHaveBeenCalledWith('inspect');
  });

  it('[BM-014] [DR-INVITE-13] allows the request when the shared store is unavailable', async () => {
    const incrementRateLimitHit = vi.fn();
    const onStoreError = vi.fn();
    const limit = createInvitationRateLimit({
      primary: {
        async limit() {
          throw new Error('store down');
        },
      },
      incrementRateLimitHit,
      onStoreError,
    });

    await expect(
      limit(new Request('https://app.example.test'), 'viewer-id', 'create'),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(onStoreError).toHaveBeenCalledWith('create');
    expect(incrementRateLimitHit).not.toHaveBeenCalled();
  });
});
