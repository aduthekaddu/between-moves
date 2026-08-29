import type { RateLimitPolicy, RateLimiter, RateLimitResult } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createSignInRateLimit, InMemoryRateLimiter } from './rate-limit';

const hour = 60 * 60;

function request(ip = '203.0.113.10'): Request {
  return new Request('https://app.example.test/api/auth/magic-link', {
    headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
  });
}

describe('sign-in rate limit', () => {
  it('[BM-009] [DR-SEC-04] denies the sixth account request for one hour', async () => {
    const metrics = { incrementRateLimitHit: vi.fn() };
    const check = createSignInRateLimit({
      primary: new InMemoryRateLimiter(),
      fallback: new InMemoryRateLimiter(),
      metrics,
      onStoreError: vi.fn(),
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(check(request(), 'Member@Example.test')).resolves.toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    }

    const denied = await check(request(), 'member@example.test');

    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(hour);
    expect(metrics.incrementRateLimitHit).toHaveBeenCalledOnce();
    expect(metrics.incrementRateLimitHit).toHaveBeenCalledWith('signin');
  });

  it('[BM-009] [DR-SEC-04] denies the twenty-first IP request across distinct accounts', async () => {
    const check = createSignInRateLimit({
      primary: new InMemoryRateLimiter(),
      fallback: new InMemoryRateLimiter(),
      metrics: { incrementRateLimitHit: vi.fn() },
      onStoreError: vi.fn(),
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await check(request(), `member-${attempt}@example.test`);
      expect(result.allowed).toBe(true);
    }

    await expect(check(request(), 'member-20@example.test')).resolves.toMatchObject({
      allowed: false,
    });
  });

  it('[BM-009] [DR-SEC-06] sends only opaque account and IP identifiers to the store', async () => {
    const seen: string[] = [];
    const primary: RateLimiter = {
      async limit(input): Promise<RateLimitResult> {
        seen.push(input.key);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    };
    const check = createSignInRateLimit({
      primary,
      fallback: new InMemoryRateLimiter(),
      metrics: { incrementRateLimitHit: vi.fn() },
      onStoreError: vi.fn(),
    });

    await check(request('203.0.113.42'), 'private.member@example.test');

    expect(seen).toHaveLength(2);
    expect(seen).toEqual([
      expect.stringMatching(/^signin:account:[a-f0-9]{64}$/),
      expect.stringMatching(/^signin:ip:[a-f0-9]{64}$/),
    ]);
    expect(seen.join(' ')).not.toContain('private.member@example.test');
    expect(seen.join(' ')).not.toContain('203.0.113.42');
  });

  it('[BM-009] [DR-SEC-04] fails open through a tighter in-process guard on store outage', async () => {
    const primary: RateLimiter = {
      limit: vi.fn(async () => {
        throw new Error('store unavailable');
      }),
    };
    const metrics = { incrementRateLimitHit: vi.fn() };
    const onStoreError = vi.fn();
    const check = createSignInRateLimit({
      primary,
      fallback: new InMemoryRateLimiter(),
      metrics,
      onStoreError,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(check(request(), 'member@example.test')).resolves.toMatchObject({
        allowed: true,
      });
    }
    await expect(check(request(), 'member@example.test')).resolves.toMatchObject({
      allowed: false,
    });

    expect(onStoreError).toHaveBeenCalledTimes(4);
    expect(onStoreError).toHaveBeenLastCalledWith('signin');
    expect(metrics.incrementRateLimitHit).toHaveBeenCalledOnce();
  });

  it('[BM-009] resets the in-process fixed window deterministically', async () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter({ now: () => now });
    const policy: RateLimitPolicy = { limit: 1, windowSeconds: 60 };

    await expect(limiter.limit({ key: 'key', policy })).resolves.toMatchObject({ allowed: true });
    await expect(limiter.limit({ key: 'key', policy })).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });

    now += 60_000;
    await expect(limiter.limit({ key: 'key', policy })).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
});
