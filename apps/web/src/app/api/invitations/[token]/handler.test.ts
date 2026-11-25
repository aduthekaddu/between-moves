import { AuthenticationRequiredError, type AuthenticatedViewer } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createInvitationRateLimit } from '../../../../kernel/invitation-rate-limit';
import { InMemoryRateLimiter } from '../../../../kernel/rate-limit';
import { createInspectInvitationRequestHandler } from './handler';

const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const validToken = 'A'.repeat(43);
const endpoint = `https://app.example.test/api/invitations/${validToken}`;

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    requireViewer: vi.fn(async () => viewer),
    rateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    inspectInvitation: vi.fn(async () => ({ houseName: 'Knights at Dusk' })),
    ...overrides,
  };
}

describe('GET /api/invitations/{token}', () => {
  it('[BM-014] [DR-INVITE-13] returns only the House name for a usable Invitation', async () => {
    const deps = dependencies();
    const request = new Request(endpoint);
    const response = await createInspectInvitationRequestHandler(deps)(request, validToken);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ houseName: 'Knights at Dusk' });
    expect(deps.rateLimit).toHaveBeenCalledWith(request, viewer.userId, 'inspect');
    expect(deps.inspectInvitation).toHaveBeenCalledWith({ token: validToken });
  });

  it('[BM-014] returns the same non-leaking problem for revoked and malformed Invitations', async () => {
    const unavailable = dependencies({ inspectInvitation: vi.fn(async () => null) });
    const first = await createInspectInvitationRequestHandler(unavailable)(
      new Request(endpoint),
      validToken,
    );
    const second = await createInspectInvitationRequestHandler(unavailable)(
      new Request(endpoint),
      'malformed-token',
    );

    expect(first.status).toBe(410);
    expect(await first.json()).toEqual(await second.json());
    expect(unavailable.inspectInvitation).toHaveBeenCalledOnce();
  });

  it('[BM-051:AC-2] answers Invitation inspection 31 with a non-disclosing 429 and Retry-After', async () => {
    const deps = dependencies();
    const handler = createInspectInvitationRequestHandler({
      ...deps,
      rateLimit: createInvitationRateLimit({
        primary: new InMemoryRateLimiter(),
        incrementRateLimitHit: vi.fn(),
        onStoreError: vi.fn(),
      }),
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await handler(new Request(endpoint), validToken)).status).toBe(200);
    }

    const limited = await handler(new Request(endpoint), validToken);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    const body: unknown = await limited.json();
    expect(body).toEqual({
      type: 'https://betweenmoves.app/problems/rate_limited',
      title: 'Too many requests',
      status: 429,
      code: 'rate_limited',
      detail: 'Try again later.',
      instance: '/api/invitations/[token]',
    });
    expect(JSON.stringify(body)).not.toContain(viewer.userId);
    expect(deps.inspectInvitation).toHaveBeenCalledTimes(30);
  });

  it('[BM-014] [DR-INVITE-13] authenticates and rate-limits every inspection attempt', async () => {
    const anonymous = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    expect(
      (
        await createInspectInvitationRequestHandler(anonymous)(
          new Request(endpoint),
          'malformed-token',
        )
      ).status,
    ).toBe(401);
    expect(anonymous.rateLimit).not.toHaveBeenCalled();

    const limited = dependencies({
      rateLimit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 23 })),
    });
    const response = await createInspectInvitationRequestHandler(limited)(
      new Request(endpoint),
      'malformed-token',
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('23');
    expect(limited.rateLimit).toHaveBeenCalledWith(expect.any(Request), viewer.userId, 'inspect');
    expect(limited.inspectInvitation).not.toHaveBeenCalled();
  });
});
