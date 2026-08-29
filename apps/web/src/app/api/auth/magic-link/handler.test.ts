import { describe, expect, it, vi } from 'vitest';
import { createMagicLinkRequestHandler } from './handler';

const url = 'https://app.example.test/api/auth/magic-link';

function request(body: unknown, origin = 'https://app.example.test'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/magic-link', () => {
  it('[BM-008] [DR-ID-03] returns the same 204 response for existing and unknown emails', async () => {
    const metrics = { incrementSignInAttempt: vi.fn() };
    const existing = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink: vi.fn(async () => undefined),
      metrics,
    });
    const unknown = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink: vi.fn(async () => {
        throw new Error('delivery unavailable');
      }),
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

  it('[BM-008] [DR-ID-03] rejects malformed input without invoking auth', async () => {
    const requestMagicLink = vi.fn();
    const handler = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink,
      metrics: { incrementSignInAttempt: vi.fn() },
    });

    const response = await handler(request({ email: 'not-an-email' }));

    expect(response.status).toBe(422);
    expect(requestMagicLink).not.toHaveBeenCalled();
  });

  it('[BM-008] [DR-ID-03] rejects an unexpected origin before any state change', async () => {
    const requestMagicLink = vi.fn();
    const handler = createMagicLinkRequestHandler({
      expectedOrigin: 'https://app.example.test',
      requestMagicLink,
      metrics: { incrementSignInAttempt: vi.fn() },
    });

    const response = await handler(request({ email: 'member@example.test' }, 'https://evil.test'));

    expect(response.status).toBe(403);
    expect(requestMagicLink).not.toHaveBeenCalled();
  });
});
