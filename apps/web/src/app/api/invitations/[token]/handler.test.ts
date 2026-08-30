import { AuthenticationRequiredError, type AuthenticatedViewer } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
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
