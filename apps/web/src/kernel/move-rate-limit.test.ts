import type { RateLimiter } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createMoveRateLimit } from './move-rate-limit';

const request = new Request('https://app.example.test/api/houses/house/games/game/moves', {
  headers: { 'x-forwarded-for': '203.0.113.9' },
});

describe('BM-024 Move rate limit', () => {
  it('[BM-024] [DR-SEC-04] applies the 60/min account and 120/min IP policies', async () => {
    const primary: RateLimiter = {
      limit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    };
    const limit = createMoveRateLimit({
      primary,
      fallback: primary,
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });

    await expect(limit(request, 'actor-id')).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(primary.limit).toHaveBeenCalledTimes(2);
    expect(primary.limit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ policy: { limit: 60, windowSeconds: 60 } }),
    );
    expect(primary.limit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ policy: { limit: 120, windowSeconds: 60 } }),
    );
  });

  it('[BM-024] uses a tightened fallback on store errors and records actual denials', async () => {
    const incrementRateLimitHit = vi.fn();
    const onStoreError = vi.fn();
    const failed = createMoveRateLimit({
      primary: { limit: vi.fn(async () => Promise.reject(new Error('store unavailable'))) },
      fallback: { limit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) },
      incrementRateLimitHit,
      onStoreError,
    });
    await expect(failed(request, 'actor-id')).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(onStoreError).toHaveBeenCalledOnce();

    const denied = createMoveRateLimit({
      primary: { limit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 17 })) },
      fallback: { limit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })) },
      incrementRateLimitHit,
      onStoreError,
    });
    await expect(denied(request, 'actor-id')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 17,
    });
    expect(incrementRateLimitHit).toHaveBeenCalledOnce();

    const fallbackDenied = createMoveRateLimit({
      primary: { limit: vi.fn(async () => Promise.reject(new Error('store unavailable'))) },
      fallback: { limit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 9 })) },
      incrementRateLimitHit,
      onStoreError,
    });
    await expect(fallbackDenied(request, 'actor-id')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 9,
    });
    expect(incrementRateLimitHit).toHaveBeenCalledTimes(2);
  });
});
