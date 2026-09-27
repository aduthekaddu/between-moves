import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstashRateLimiter, type UpstashLimitClientFactory } from './upstash-rate-limiter';

describe('UpstashRateLimiter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('[BM-009] [DR-SEC-04] maps provider denial reset time to Retry-After seconds', async () => {
    const clientFactory: UpstashLimitClientFactory = vi.fn(() => ({
      limit: vi.fn(async () => ({ success: false, reset: 65_500 })),
    }));
    const limiter = new UpstashRateLimiter({ clientFactory, now: () => 5_000 });

    await expect(
      limiter.limit({ key: 'signin:account:digest', policy: { limit: 5, windowSeconds: 3_600 } }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 61 });
  });

  it('[BM-009] reuses one provider client for equivalent policies', async () => {
    const clientFactory: UpstashLimitClientFactory = vi.fn(() => ({
      limit: vi.fn(async () => ({ success: true, reset: 65_000 })),
    }));
    const limiter = new UpstashRateLimiter({ clientFactory, now: () => 5_000 });
    const policy = { limit: 5, windowSeconds: 3_600 };

    await limiter.limit({ key: 'account-a', policy });
    await limiter.limit({ key: 'account-b', policy });

    expect(clientFactory).toHaveBeenCalledOnce();
    expect(clientFactory).toHaveBeenCalledWith(policy);
  });

  it('[BM-009] [DR-SEC-04] rejects on the first store failure so callers fall back without retry sleeps', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);
    const limiter = new UpstashRateLimiter({ url: 'https://rate-limit.test', token: 'token' });

    await expect(
      limiter.limit({ key: 'signin:account:digest', policy: { limit: 5, windowSeconds: 3_600 } }),
    ).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('[BM-009] [DR-SEC-04] rejects a hung store request at the deadline instead of allowing it', async () => {
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const limiter = new UpstashRateLimiter({ url: 'https://rate-limit.test', token: 'token' });

    await expect(
      limiter.limit({ key: 'signin:account:digest', policy: { limit: 5, windowSeconds: 3_600 } }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
