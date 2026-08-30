import type { AuthenticatedViewer } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { revokeInvitation } from './revoke-invitation';

const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

describe('revokeInvitation', () => {
  it('[BM-014] [DR-INVITE-06] authorizes route-scoped revocation and audits the command', async () => {
    const houseId = '01941f29-7c00-7000-8000-000000000201';
    const invitationId = '01941f29-7c00-7000-8000-000000000301';
    const context = fakeAuthorizationContext({ viewerId: viewer.userId, houseId });
    const authorizeHouseAction = vi.fn(async () => context);
    const revoke = vi.fn(async () => ({ revokedNow: true }));

    await expect(
      revokeInvitation(
        { houseId, invitationId, viewer },
        {
          authorizeHouseAction,
          clock: { now: () => new Date('2026-08-30T11:00:00.000Z') },
          ids: { generate: () => '01941f29-7c00-7000-8000-000000000302' },
          invitations: { revoke },
        },
      ),
    ).resolves.toEqual({ revokedNow: true });
    expect(authorizeHouseAction).toHaveBeenCalledWith({ kind: 'revoke_invite' }, houseId, viewer);
    expect(revoke).toHaveBeenCalledWith(context, {
      invitationId,
      auditId: '01941f29-7c00-7000-8000-000000000302',
      revokedAt: new Date('2026-08-30T11:00:00.000Z'),
    });
  });
});
