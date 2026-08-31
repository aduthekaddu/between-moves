import type {
  AuthenticatedViewer,
  InvitationRedemptionInput,
  InvitationRedemptionResult,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { redeemInvitation } from './redeem-invitation';

const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

describe('redeemInvitation', () => {
  it('[BM-016] [DR-INVITE-07/08] redeems a digest without exposing the raw token to persistence', async () => {
    const redeem = vi.fn(
      async (input: InvitationRedemptionInput): Promise<InvitationRedemptionResult> => ({
        houseId: '01941f29-7c00-7000-8000-000000000201',
        membershipId: input.membershipId,
        inviteKind: 'shared',
        reactivated: false,
      }),
    );
    const ids = ['01941f29-7c00-7000-8000-000000000301', '01941f29-7c00-7000-8000-000000000302'];

    const result = await redeemInvitation(
      { token: 'raw-invitation-token', viewer },
      {
        clock: { now: () => new Date('2026-08-31T10:00:00.000Z') },
        ids: {
          generate() {
            const id = ids.shift();
            if (id === undefined) throw new Error('Unexpected ID allocation');
            return id;
          },
        },
        tokens: { digest: vi.fn(() => 'a'.repeat(64)) },
        invitations: { redeem },
      },
    );

    expect(redeem).toHaveBeenCalledWith({
      tokenDigestHex: 'a'.repeat(64),
      userId: viewer.userId,
      membershipId: '01941f29-7c00-7000-8000-000000000301',
      auditId: '01941f29-7c00-7000-8000-000000000302',
      redeemedAt: new Date('2026-08-31T10:00:00.000Z'),
    });
    expect(JSON.stringify(redeem.mock.calls)).not.toContain('raw-invitation-token');
    expect(result).toEqual({
      houseId: '01941f29-7c00-7000-8000-000000000201',
      membershipId: '01941f29-7c00-7000-8000-000000000301',
      inviteKind: 'shared',
      reactivated: false,
    });
  });
});
