import { describe, expect, it, vi } from 'vitest';
import { createRecoveryRequestHandler } from './handler';

const endpoint = 'https://app.example.test/api/auth/recovery';
const allow = vi.fn(async () => ({ allowed: true as const, retryAfterSeconds: 0 }));

function request(email: string, origin = 'https://app.example.test'): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email }),
  });
}

describe('POST /api/auth/recovery', () => {
  it('[BM-010] [DR-ID-02] returns the same response for known, unknown, and email-failure paths', async () => {
    const metrics = { incrementRecoveryAttempt: vi.fn() };
    const handlers = [
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
      vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    ].map((requestRecovery) =>
      createRecoveryRequestHandler({
        expectedOrigin: 'https://app.example.test',
        requestRecovery,
        rateLimit: allow,
        metrics,
      }),
    );

    for (const [index, handler] of handlers.entries()) {
      const response = await handler(request(`member-${index}@example.test`));
      expect({
        status: response.status,
        body: await response.text(),
        cacheControl: response.headers.get('cache-control'),
      }).toEqual({
        status: 204,
        body: '',
        cacheControl: 'no-store',
      });
    }
    expect(metrics.incrementRecoveryAttempt).toHaveBeenLastCalledWith('error');
  });

  it('[BM-010] [DR-SEC-04] returns a bodyless non-disclosing 429 with Retry-After', async () => {
    const requestRecovery = vi.fn();
    const handler = createRecoveryRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestRecovery,
      rateLimit: vi.fn(async () => ({ allowed: false as const, retryAfterSeconds: 41 })),
      metrics: { incrementRecoveryAttempt: vi.fn() },
    });

    const response = await handler(request('member@example.test'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('41');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
    expect(requestRecovery).not.toHaveBeenCalled();
  });

  it('[BM-010] [DR-ID-03] rejects an unexpected origin before recovery or rate limiting', async () => {
    const requestRecovery = vi.fn();
    const rateLimit = vi.fn();
    const handler = createRecoveryRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestRecovery,
      rateLimit,
      metrics: { incrementRecoveryAttempt: vi.fn() },
    });

    const response = await handler(request('member@example.test', 'https://evil.test'));

    expect(response.status).toBe(403);
    expect(requestRecovery).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
