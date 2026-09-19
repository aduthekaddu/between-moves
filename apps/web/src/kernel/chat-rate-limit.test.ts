import type { RateLimiter } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from './rate-limit';
import { createChatRateLimit } from './chat-rate-limit';

const request = new Request('https://app.example.test/nights/night/chat', {
  headers: { 'x-forwarded-for': '203.0.113.9' },
});

describe('BM-040 House chat rate limit', () => {
  it('[BM-040] [DR-SEC-04] applies 20/min account and 40/min IP policies', async () => {
    const primary: RateLimiter = {
      limit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    };
    const limit = createChatRateLimit({
      primary,
      fallback: primary,
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });

    await expect(limit(request, 'actor-id')).resolves.toMatchObject({ allowed: true });
    expect(primary.limit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ policy: { limit: 20, windowSeconds: 60 } }),
    );
    expect(primary.limit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ policy: { limit: 40, windowSeconds: 60 } }),
    );
  });

  it('[BM-040] denies account request 21 and returns Retry-After', async () => {
    const incrementRateLimitHit = vi.fn();
    const limit = createChatRateLimit({
      primary: new InMemoryRateLimiter(),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit,
      onStoreError: vi.fn(),
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(limit(request, 'same-actor')).resolves.toMatchObject({ allowed: true });
    }
    await expect(limit(request, 'same-actor')).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    });
    expect(incrementRateLimitHit).toHaveBeenCalledOnce();
  });

  it('[BM-040] [DR-SEC-04] denies IP request 41 across distinct accounts', async () => {
    const limit = createChatRateLimit({
      primary: new InMemoryRateLimiter(),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: vi.fn(),
      onStoreError: vi.fn(),
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await expect(limit(request, `actor-${attempt}`)).resolves.toMatchObject({ allowed: true });
    }
    await expect(limit(request, 'actor-40')).resolves.toMatchObject({ allowed: false });
  });

  it('[BM-040] uses the in-process fallback when the primary store fails', async () => {
    const onStoreError = vi.fn();
    const limit = createChatRateLimit({
      primary: { limit: vi.fn(async () => Promise.reject(new Error('unavailable'))) },
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: vi.fn(),
      onStoreError,
    });
    await expect(limit(request, 'actor-id')).resolves.toMatchObject({ allowed: true });
    expect(onStoreError).toHaveBeenCalledOnce();
  });
});
