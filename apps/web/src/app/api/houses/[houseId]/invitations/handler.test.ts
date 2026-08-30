import {
  AuthenticationRequiredError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createInvitationRequestHandler } from './handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const endpoint = `https://app.example.test/api/houses/${houseId}/invitations`;
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(body: unknown, origin = 'https://app.example.test'): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-request-id': 'request-bm-014',
      'idempotency-key': 'request-key-1',
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  let milliseconds = Date.parse('2026-08-30T10:00:00.000Z');
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    rateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    createInvitation: vi.fn(async () => ({
      invitationId: '01941f29-7c00-7000-8000-000000000301',
      houseId,
      token: 'secret-raw-invitation-token',
      expiresAt: new Date('2026-09-06T10:00:00.000Z'),
      useLimit: 28,
    })),
    logger: { log: vi.fn() } satisfies StructuredLogger,
    clock: {
      now() {
        const value = new Date(milliseconds);
        milliseconds += 10;
        return value;
      },
    },
    ...overrides,
  };
}

describe('POST /api/houses/{houseId}/invitations', () => {
  it('[BM-014] [DR-INVITE-02/04/13] returns the raw token once without logging it', async () => {
    const deps = dependencies();
    const response = await createInvitationRequestHandler(deps)(
      request({ kind: 'shared' }),
      houseId,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      token: 'secret-raw-invitation-token',
      expiresAt: '2026-09-06T10:00:00.000Z',
    });
    expect(deps.rateLimit).toHaveBeenCalledWith(expect.any(Request), viewer.userId, 'create');
    expect(deps.createInvitation).toHaveBeenCalledWith({
      houseId,
      command: { kind: 'shared' },
      idempotencyKey: 'request-key-1',
      viewer,
    });
    expect(JSON.stringify(deps.logger.log.mock.calls)).not.toContain('secret-raw-invitation-token');
  });

  it('[BM-014] [DR-INVITE-05] accepts only a valid email-restricted single Invitation', async () => {
    const deps = dependencies();
    await createInvitationRequestHandler(deps)(
      request({ kind: 'single', intendedEmail: 'friend@example.test' }),
      houseId,
    );
    expect(deps.createInvitation).toHaveBeenCalledWith({
      houseId,
      command: { kind: 'single', intendedEmail: 'friend@example.test' },
      idempotencyKey: 'request-key-1',
      viewer,
    });

    const invalid = dependencies();
    const response = await createInvitationRequestHandler(invalid)(
      request({ kind: 'single' }),
      houseId,
    );
    expect(response.status).toBe(422);
    expect(invalid.createInvitation).not.toHaveBeenCalled();
  });

  it('[BM-014] denies anonymous, cross-origin, rate-limited, and member-only creation', async () => {
    const anonymous = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    expect(
      (await createInvitationRequestHandler(anonymous)(request({ kind: 'shared' }), houseId))
        .status,
    ).toBe(401);

    const limited = dependencies({
      rateLimit: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 19 })),
    });
    const limitedResponse = await createInvitationRequestHandler(limited)(
      request({ kind: 'shared' }),
      houseId,
    );
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get('retry-after')).toBe('19');
    expect(limited.createInvitation).not.toHaveBeenCalled();

    const denied = dependencies({
      createInvitation: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('role_not_permitted', false);
      }),
    });
    expect(
      (await createInvitationRequestHandler(denied)(request({ kind: 'shared' }), houseId)).status,
    ).toBe(403);

    const crossOrigin = dependencies();
    expect(
      (
        await createInvitationRequestHandler(crossOrigin)(
          request({ kind: 'shared' }, 'https://evil.test'),
          houseId,
        )
      ).status,
    ).toBe(403);
  });

  it('[BM-014] rejects invalid route IDs and oversized bodies at the request seam', async () => {
    const invalidId = dependencies();
    const invalidIdResponse = await createInvitationRequestHandler(invalidId)(
      request({ kind: 'shared' }),
      'not-a-house-id',
    );
    expect(invalidIdResponse.status).toBe(422);
    expect(invalidId.createInvitation).not.toHaveBeenCalled();

    const oversized = dependencies();
    const oversizedResponse = await createInvitationRequestHandler(oversized)(
      request({ kind: 'single', intendedEmail: `${'x'.repeat(5_000)}@example.test` }),
      houseId,
    );
    expect(oversizedResponse.status).toBe(413);
    expect(await oversizedResponse.json()).toMatchObject({ code: 'payload_too_large' });
    expect(oversized.createInvitation).not.toHaveBeenCalled();
  });
});
