import { describe, expect, it, vi } from 'vitest';
import { createSignInRateLimit, InMemoryRateLimiter } from '../../../../kernel/rate-limit';
import { createMagicLinkRequestHandler } from './handler';

const url = 'https://app.example.test/api/auth/magic-link';
const allow = vi.fn(async () => ({ allowed: true as const, retryAfterSeconds: 0 }));

function request(body: unknown, origin = 'https://app.example.test'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/magic-link', () => {
  it('[BM-016] [DR-INVITE-09] carries a valid Invitation return path into magic-link delivery', async () => {
    const requestMagicLink = vi.fn(async () => undefined);
    const handler = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink,
      rateLimit: allow,
      metrics: { incrementSignInAttempt: vi.fn() },
    });
    const returnTo = `/invitations/${'A'.repeat(43)}`;

    const response = await handler(request({ email: 'friend@example.test', returnTo }));

    expect(response.status).toBe(204);
    expect(requestMagicLink).toHaveBeenCalledWith(
      'friend@example.test',
      expect.any(Headers),
      returnTo,
    );
  });

  it('[BM-016] rejects an external magic-link return URL', async () => {
    const requestMagicLink = vi.fn(async () => undefined);
    const handler = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink,
      rateLimit: allow,
      metrics: { incrementSignInAttempt: vi.fn() },
    });

    const response = await handler(
      request({ email: 'friend@example.test', returnTo: 'https://evil.example.test/steal' }),
    );

    expect(response.status).toBe(422);
    expect(requestMagicLink).not.toHaveBeenCalled();
  });

  it('[BM-008] [DR-ID-03] returns the same 204 response for existing and unknown emails', async () => {
    const metrics = { incrementSignInAttempt: vi.fn() };
    const existing = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink: vi.fn(async () => undefined),
      rateLimit: allow,
      metrics,
    });
    const unknown = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink: vi.fn(async () => {
        throw new Error('delivery unavailable');
      }),
      rateLimit: allow,
      metrics,
    });

    const existingResponse = await existing(request({ email: 'known@example.test' }));
    const unknownResponse = await unknown(request({ email: 'unknown@example.test' }));

    expect({ status: existingResponse.status, body: await existingResponse.text() }).toEqual({
      status: 204,
      body: '',
    });
    expect({ status: unknownResponse.status, body: await unknownResponse.text() }).toEqual({
      status: 204,
      body: '',
    });
  });

  it('[BM-009] [DR-SEC-04] returns the same bodyless 429 without account disclosure', async () => {
    const knownRequest = vi.fn(async () => undefined);
    const unknownRequest = vi.fn(async () => {
      throw new Error('account absent');
    });
    const denied = vi.fn(async () => ({ allowed: false as const, retryAfterSeconds: 37 }));
    const dependencies = {
      expectedOrigin: 'https://app.example.test',
      rateLimit: denied,
      metrics: { incrementSignInAttempt: vi.fn() },
    };
    const known = createMagicLinkRequestHandler({
      ...dependencies,
      requestMagicLink: knownRequest,
    });
    const unknown = createMagicLinkRequestHandler({
      ...dependencies,
      requestMagicLink: unknownRequest,
    });

    const knownResponse = await known(request({ email: 'known@example.test' }));
    const unknownResponse = await unknown(request({ email: 'unknown@example.test' }));

    for (const response of [knownResponse, unknownResponse]) {
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('37');
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.text()).resolves.toBe('');
    }
    expect(knownRequest).not.toHaveBeenCalled();
    expect(unknownRequest).not.toHaveBeenCalled();
  });

  it('[BM-009] [DR-SEC-04] enforces the account threshold at the route seam and emits its metric', async () => {
    const requestMagicLink = vi.fn(async () => undefined);
    const metrics = {
      incrementSignInAttempt: vi.fn(),
      incrementRateLimitHit: vi.fn(),
    };
    const handler = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink,
      rateLimit: createSignInRateLimit({
        primary: new InMemoryRateLimiter(),
        fallback: new InMemoryRateLimiter(),
        metrics,
        onStoreError: vi.fn(),
      }),
      metrics,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(handler(request({ email: 'member@example.test' }))).resolves.toMatchObject({
        status: 204,
      });
    }
    const denied = await handler(request({ email: 'member@example.test' }));

    expect(denied.status).toBe(429);
    expect(requestMagicLink).toHaveBeenCalledTimes(5);
    expect(metrics.incrementRateLimitHit).toHaveBeenCalledOnce();
    expect(metrics.incrementRateLimitHit).toHaveBeenCalledWith('signin');
  });

  it('[BM-008] [DR-ID-03] rejects malformed input without invoking auth', async () => {
    const requestMagicLink = vi.fn();
    const handler = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink,
      rateLimit: allow,
      metrics: { incrementSignInAttempt: vi.fn() },
    });

    const response = await handler(request({ email: 'not-an-email' }));

    expect(response.status).toBe(422);
    expect(requestMagicLink).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalledWith(expect.anything(), 'not-an-email');
  });

  it('[BM-008] rejects an oversized body before rate limiting or auth', async () => {
    const requestMagicLink = vi.fn();
    const rateLimit = vi.fn();
    const metrics = { incrementSignInAttempt: vi.fn() };
    const handler = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink,
      rateLimit,
      metrics,
    });

    const response = await handler(
      request({ email: 'member@example.test', returnTo: `/${'x'.repeat(5_000)}` }),
    );

    expect(response.status).toBe(413);
    expect(await response.text()).toBe('');
    expect(rateLimit).not.toHaveBeenCalled();
    expect(requestMagicLink).not.toHaveBeenCalled();
    expect(metrics.incrementSignInAttempt).toHaveBeenCalledWith('rejected');
  });

  it('[BM-008] [DR-ID-03] rejects an unexpected origin before any state change', async () => {
    const requestMagicLink = vi.fn();
    const handler = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink,
      rateLimit: allow,
      metrics: { incrementSignInAttempt: vi.fn() },
    });

    const response = await handler(request({ email: 'member@example.test' }, 'https://evil.test'));

    expect(response.status).toBe(403);
    expect(requestMagicLink).not.toHaveBeenCalled();
  });
});
