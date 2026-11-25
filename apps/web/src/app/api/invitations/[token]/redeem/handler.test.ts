import {
  AuthenticationRequiredError,
  InvitationRedemptionError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createInvitationRateLimit } from '../../../../../kernel/invitation-rate-limit';
import { InMemoryRateLimiter } from '../../../../../kernel/rate-limit';
import { createRedeemInvitationRequestHandler } from './handler';

const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const validToken = 'A'.repeat(43);
const endpoint = `https://app.example.test/api/invitations/${validToken}/redeem`;

function request(origin = 'https://app.example.test'): Request {
  return new Request(endpoint, { method: 'POST', headers: { origin, 'x-request-id': 'bm-016' } });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    rateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    redeemInvitation: vi.fn(async () => ({
      houseId: '01941f29-7c00-7000-8000-000000000201',
      membershipId: '01941f29-7c00-7000-8000-000000000301',
      inviteKind: 'shared' as const,
      reactivated: false,
    })),
    logger: { log: vi.fn() },
    clock: { now: vi.fn(() => new Date('2026-08-31T10:00:00.000Z')) },
    ...overrides,
  };
}

describe('POST /api/invitations/{token}/redeem', () => {
  it('[BM-016] [DR-INVITE-08/13] admits the viewer through the rate-limited command seam', async () => {
    const deps = dependencies();
    const incoming = request();

    const response = await createRedeemInvitationRequestHandler(deps)(incoming, validToken);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      houseId: '01941f29-7c00-7000-8000-000000000201',
      membershipId: '01941f29-7c00-7000-8000-000000000301',
    });
    expect(deps.rateLimit).toHaveBeenCalledWith(incoming, viewer.userId, 'redeem');
    expect(deps.redeemInvitation).toHaveBeenCalledWith({ token: validToken, viewer });
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'bm-016',
        actorId: viewer.userId,
        houseId: '01941f29-7c00-7000-8000-000000000201',
        event: 'bm.invite.redeemed',
        outcome: 'success',
        data: {
          actor_membership_id: '01941f29-7c00-7000-8000-000000000301',
          invite_kind: 'shared',
          membership_id: '01941f29-7c00-7000-8000-000000000301',
          reactivated: false,
        },
      }),
    );
    expect(JSON.stringify(deps.logger.log.mock.calls)).not.toContain(validToken);
  });

  it('[BM-016] [DR-ID-03] rejects another origin before authentication or mutation', async () => {
    const deps = dependencies();
    const response = await createRedeemInvitationRequestHandler(deps)(
      request('https://evil.example.test'),
      validToken,
    );

    expect(response.status).toBe(403);
    expect(deps.requireViewer).not.toHaveBeenCalled();
    expect(deps.redeemInvitation).not.toHaveBeenCalled();
  });

  it('[BM-016] requires sign-in and applies the redemption limit before token parsing', async () => {
    const anonymous = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const anonymousResponse = await createRedeemInvitationRequestHandler(anonymous)(
      request(),
      validToken,
    );
    expect(anonymousResponse.status).toBe(401);
    expect(anonymous.rateLimit).not.toHaveBeenCalled();

    const limited = dependencies({
      rateLimit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 19 })),
    });
    const limitedResponse = await createRedeemInvitationRequestHandler(limited)(
      request(),
      'malformed',
    );
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get('retry-after')).toBe('19');
    expect(limited.redeemInvitation).not.toHaveBeenCalled();
  });

  it('[BM-051:AC-2] answers Invitation redemption 11 with a non-disclosing 429 and Retry-After', async () => {
    const deps = dependencies();
    const handler = createRedeemInvitationRequestHandler({
      ...deps,
      rateLimit: createInvitationRateLimit({
        primary: new InMemoryRateLimiter(),
        incrementRateLimitHit: vi.fn(),
        onStoreError: vi.fn(),
      }),
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await handler(request(), validToken)).status).toBe(200);
    }

    const limited = await handler(request(), validToken);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    const body: unknown = await limited.json();
    expect(body).toEqual({
      type: 'https://betweenmoves.app/problems/rate_limited',
      title: 'Too many requests',
      status: 429,
      code: 'rate_limited',
      detail: 'Try again later.',
      instance: '/api/invitations/[token]/redeem',
    });
    expect(JSON.stringify(body)).not.toContain(viewer.userId);
    expect(deps.redeemInvitation).toHaveBeenCalledTimes(10);
  });

  it('[BM-016] returns distinct non-leaking invalid and full outcomes', async () => {
    const invalid = dependencies({
      redeemInvitation: vi.fn(async () => {
        throw new InvitationRedemptionError('invalid');
      }),
    });
    const invalidResponse = await createRedeemInvitationRequestHandler(invalid)(
      request(),
      validToken,
    );
    expect(invalidResponse.status).toBe(410);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      code: 'invite_invalid',
      detail: 'This Invitation cannot be used.',
    });

    const full = dependencies({
      redeemInvitation: vi.fn(async () => {
        throw new InvitationRedemptionError('house_full');
      }),
    });
    const fullResponse = await createRedeemInvitationRequestHandler(full)(request(), validToken);
    expect(fullResponse.status).toBe(403);
    await expect(fullResponse.json()).resolves.toMatchObject({
      code: 'forbidden',
      detail: 'This House is full. No more members can join right now.',
    });
  });
});
