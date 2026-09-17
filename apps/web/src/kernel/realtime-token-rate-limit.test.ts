import type { RateLimiter } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from './rate-limit';
import { createRealtimeTokenRateLimit } from './realtime-token-rate-limit';

const request = new Request('https://app.example.test/nights/night/realtime-token', {
  headers: { 'x-forwarded-for': '203.0.113.9' },
});

describe('BM-037 Realtime token rate limit', () => {
  it('[BM-037] [DR-SEC-04] applies the 30/min account and 60/min IP policies', async () => {
    const primary: RateLimiter = {
      limit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    };
    const limit = createRealtimeTokenRateLimit({
      primary,
      fallback: primary,
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });

    await expect(limit(request, 'actor-id')).resolves.toMatchObject({ allowed: true });
    expect(primary.limit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ policy: { limit: 30, windowSeconds: 60 } }),
    );
    expect(primary.limit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ policy: { limit: 60, windowSeconds: 60 } }),
    );
  });

  it('[BM-037] [DR-SEC-04] denies account request 31 and resets after one minute', async () => {
    let now = 1_000;
    const incrementRateLimitHit = vi.fn();
    const limit = createRealtimeTokenRateLimit({
      primary: new InMemoryRateLimiter({ now: () => now }),
      fallback: new InMemoryRateLimiter({ now: () => now }),
      incrementRateLimitHit,
      onStoreError: vi.fn(),
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await expect(
        limit(
          new Request('https://app.example.test/nights/night/realtime-token', {
            headers: { 'x-forwarded-for': `203.0.113.${attempt}` },
          }),
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

  it('[BM-037] [DR-SEC-04] denies IP request 61 across distinct accounts', async () => {
    const limit = createRealtimeTokenRateLimit({
      primary: new InMemoryRateLimiter(),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await expect(limit(request, `actor-${attempt}`)).resolves.toMatchObject({ allowed: true });
    }
    await expect(limit(request, 'actor-60')).resolves.toMatchObject({ allowed: false });
  });

  it('[BM-037] uses the in-process fallback when the primary store fails', async () => {
    const onStoreError = vi.fn();
    const limit = createRealtimeTokenRateLimit({
      primary: { limit: vi.fn(async () => Promise.reject(new Error('unavailable'))) },
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: vi.fn(),
      onStoreError,
    });
    await expect(limit(request, 'actor-id')).resolves.toMatchObject({ allowed: true });
    expect(onStoreError).toHaveBeenCalledOnce();
  });
});
