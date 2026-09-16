import type { RateLimiter } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from './rate-limit';
import { createNoteRateLimit } from './note-rate-limit';

const request = new Request('https://app.example.test/games/game/note', {
  headers: { 'x-forwarded-for': '203.0.113.9' },
});

describe('BM-032 Game note rate limit', () => {
  it('[BM-032] [DR-SEC-04] applies 10/min account and 20/min IP policies', async () => {
    const primary: RateLimiter = {
      limit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    };
    const limit = createNoteRateLimit({
      primary,
      fallback: primary,
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });

    await expect(limit(request, 'actor-id')).resolves.toMatchObject({ allowed: true });
    expect(primary.limit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ policy: { limit: 10, windowSeconds: 60 } }),
    );
    expect(primary.limit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ policy: { limit: 20, windowSeconds: 60 } }),
    );
  });

  it('[BM-032] denies account request 11 and returns Retry-After', async () => {
    const incrementRateLimitHit = vi.fn();
    const limit = createNoteRateLimit({
      primary: new InMemoryRateLimiter(),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit,
      onStoreError: vi.fn(),
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(limit(request, 'same-actor')).resolves.toMatchObject({ allowed: true });
    }
    await expect(limit(request, 'same-actor')).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    });
    expect(incrementRateLimitHit).toHaveBeenCalledOnce();
  });

  it('[BM-032] [DR-SEC-04] denies IP request 21 across distinct accounts', async () => {
    const limit = createNoteRateLimit({
      primary: new InMemoryRateLimiter(),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(limit(request, `actor-${attempt}`)).resolves.toMatchObject({ allowed: true });
    }
    await expect(limit(request, 'actor-20')).resolves.toMatchObject({ allowed: false });
  });

  it('[BM-032] uses the in-process fallback when the primary store fails', async () => {
    const onStoreError = vi.fn();
    const limit = createNoteRateLimit({
      primary: { limit: vi.fn(async () => Promise.reject(new Error('unavailable'))) },
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: vi.fn(),
      onStoreError,
    });
    await expect(limit(request, 'actor-id')).resolves.toMatchObject({ allowed: true });
    expect(onStoreError).toHaveBeenCalledOnce();
  });
});
