import type { RateLimiter } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from './rate-limit';
import { createPresenceRateLimit } from './presence-rate-limit';

const request = new Request('https://app.example.test/presence', {
  headers: { 'x-forwarded-for': '203.0.113.9' },
});

describe('BM-039 presence rate limit', () => {
  it('[BM-039] applies separate account and IP policies', async () => {
    const primary: RateLimiter = {
      limit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    };
    const limit = createPresenceRateLimit({
      primary,
      fallback: primary,
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });

    await expect(limit(request, 'actor-id')).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(primary.limit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ policy: { limit: 60, windowSeconds: 60 } }),
    );
    expect(primary.limit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ policy: { limit: 120, windowSeconds: 60 } }),
    );
  });

  it('[BM-039] denies replay 61 for one account and emits Retry-After data', async () => {
    let now = 1_000;
    const incrementRateLimitHit = vi.fn();
    const limit = createPresenceRateLimit({
      primary: new InMemoryRateLimiter({ now: () => now }),
      fallback: new InMemoryRateLimiter({ now: () => now }),
      incrementRateLimitHit,
      onStoreError: vi.fn(),
    });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await expect(
        limit(
          new Request(request, { headers: { 'x-forwarded-for': `203.0.113.${attempt}` } }),
          'same-actor',
        ),
      ).resolves.toMatchObject({ allowed: true });
    }
    await expect(limit(request, 'same-actor')).resolves.toMatchObject({ allowed: false });
    expect(incrementRateLimitHit).toHaveBeenCalledOnce();

    now += 60_000;
    await expect(limit(request, 'same-actor')).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('[BM-039] uses the fallback without letting diagnostics change its decision', async () => {
    const limit = createPresenceRateLimit({
      primary: { limit: vi.fn(async () => Promise.reject(new Error('unavailable'))) },
      fallback: { limit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 9 })) },
      incrementRateLimitHit: () => {
        throw new Error('metrics unavailable');
      },
      onStoreError: () => {
        throw new Error('logger unavailable');
      },
    });

    await expect(limit(request, 'actor-id')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 9,
    });
  });
});
