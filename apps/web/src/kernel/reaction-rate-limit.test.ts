import type { RateLimiter } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from './rate-limit';
import { createReactionRateLimit } from './reaction-rate-limit';

const request = new Request('https://app.example.test/games/game/reactions', {
  headers: { 'x-forwarded-for': '203.0.113.9' },
});

describe('BM-031 Reaction rate limit', () => {
  it('[BM-031] [DR-SEC-04] applies the 60/min account and 120/min IP policies', async () => {
    const primary: RateLimiter = {
      limit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    };
    const limit = createReactionRateLimit({
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

  it('[BM-031] records a denied fallback and returns its Retry-After', async () => {
    const incrementRateLimitHit = vi.fn();
    const limit = createReactionRateLimit({
      primary: { limit: vi.fn(async () => Promise.reject(new Error('unavailable'))) },
      fallback: { limit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 11 })) },
      incrementRateLimitHit,
      onStoreError: vi.fn(),
    });

    await expect(limit(request, 'actor-id')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 11,
    });
    expect(incrementRateLimitHit).toHaveBeenCalledOnce();
  });

  it('[BM-031] [DR-SEC-04] denies account request 61 and resets after one minute', async () => {
    let now = 1_000;
    const limit = createReactionRateLimit({
      primary: new InMemoryRateLimiter({ now: () => now }),
      fallback: new InMemoryRateLimiter({ now: () => now }),
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = await limit(
        new Request('https://app.example.test/games/game/reactions', {
          headers: { 'x-forwarded-for': `203.0.113.${attempt}` },
        }),
        'same-actor',
      );
      expect(result.allowed).toBe(true);
    }
    await expect(limit(request, 'same-actor')).resolves.toMatchObject({ allowed: false });

    now += 60_000;
    await expect(limit(request, 'same-actor')).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('[BM-031] [DR-SEC-04] denies IP request 121 across distinct accounts', async () => {
    const limit = createReactionRateLimit({
      primary: new InMemoryRateLimiter(),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await expect(limit(request, `actor-${attempt}`)).resolves.toMatchObject({ allowed: true });
    }
    await expect(limit(request, 'actor-120')).resolves.toMatchObject({ allowed: false });
  });

  it('[BM-031] keeps limiter decisions intact when diagnostics fail', async () => {
    const fallback = createReactionRateLimit({
      primary: { limit: vi.fn(async () => Promise.reject(new Error('unavailable'))) },
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: vi.fn(),
      onStoreError: () => {
        throw new Error('logger unavailable');
      },
    });
    await expect(fallback(request, 'actor-id')).resolves.toMatchObject({ allowed: true });

    const denied = createReactionRateLimit({
      primary: { limit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 7 })) },
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: () => {
        throw new Error('metrics unavailable');
      },
      onStoreError: vi.fn(),
    });
    await expect(denied(request, 'actor-id')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 7,
    });
  });
});
