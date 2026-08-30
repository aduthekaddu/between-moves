import {
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createRevokeInvitationRequestHandler } from './handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const invitationId = '01941f29-7c00-7000-8000-000000000301';
const endpoint = `https://app.example.test/api/houses/${houseId}/invitations/${invitationId}/revoke`;
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(origin = 'https://app.example.test') {
  return new Request(endpoint, { method: 'POST', headers: { origin, 'x-request-id': 'bm-014' } });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  let milliseconds = Date.parse('2026-08-30T10:00:00.000Z');
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    revokeInvitation: vi.fn(async () => ({ revokedNow: true })),
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

describe('POST /api/houses/{houseId}/invitations/{id}/revoke', () => {
  it('[BM-014] [DR-INVITE-06] revokes and logs no token or email data', async () => {
    const deps = dependencies();
    const response = await createRevokeInvitationRequestHandler(deps)(
      request(),
      houseId,
      invitationId,
    );

    expect(response.status).toBe(204);
    expect(deps.revokeInvitation).toHaveBeenCalledWith({ houseId, invitationId, viewer });
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: viewer.userId,
        houseId,
        event: 'house.invitation-revoked',
        data: { invitation_id: invitationId, revoked_now: true },
      }),
    );
  });

  it('[BM-014] maps cross-House denial and missing Invitation without mutation details', async () => {
    const denied = dependencies({
      revokeInvitation: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
    });
    expect(
      (await createRevokeInvitationRequestHandler(denied)(request(), houseId, invitationId)).status,
    ).toBe(403);

    const missing = dependencies({
      revokeInvitation: vi.fn(async () => {
        throw new DomainError('not_found', 'Invitation is unavailable');
      }),
    });
    expect(
      (await createRevokeInvitationRequestHandler(missing)(request(), houseId, invitationId))
        .status,
    ).toBe(404);
    expect(missing.logger.log).not.toHaveBeenCalled();
  });

  it('[BM-014] rejects an unexpected origin before revocation', async () => {
    const deps = dependencies();
    const response = await createRevokeInvitationRequestHandler(deps)(
      request('https://evil.test'),
      houseId,
      invitationId,
    );
    expect(response.status).toBe(403);
    expect(deps.revokeInvitation).not.toHaveBeenCalled();
  });

  it('[BM-014] rejects invalid House and Invitation IDs at the request seam', async () => {
    const deps = dependencies();
    const response = await createRevokeInvitationRequestHandler(deps)(
      request(),
      houseId,
      'not-an-invitation-id',
    );
    expect(response.status).toBe(422);
    expect(deps.revokeInvitation).not.toHaveBeenCalled();
  });
});
