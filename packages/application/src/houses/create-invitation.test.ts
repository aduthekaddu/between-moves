import type { AuthenticatedViewer, InvitationCreationInput } from '@between-moves/domain';
import { fakeAuthorizationContext } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { createInvitation } from './create-invitation';

const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const context = fakeAuthorizationContext({
  viewerId: viewer.userId,
  houseId: '01941f29-7c00-7000-8000-000000000201',
});

describe('createInvitation', () => {
  it('[BM-014] [DR-INVITE-02/06] authorizes creation and persists only the token digest', async () => {
    const authorizeHouseAction = vi.fn(async () => context);
    const create = vi.fn(async (_context: typeof context, input: InvitationCreationInput) => ({
      invitationId: input.invitationId,
      houseId: context.houseId,
      expiresAt: new Date('2026-09-06T10:00:00.000Z'),
      useLimit: 23,
    }));
    const generatedIds = [
      '01941f29-7c00-7000-8000-000000000301',
      '01941f29-7c00-7000-8000-000000000302',
    ];
    const issue = vi.fn(() => ({
      raw: 'raw-invitation-token',
      digestHex: 'a'.repeat(64),
    }));
    const result = await createInvitation(
      {
        houseId: context.houseId,
        command: { kind: 'shared' },
        idempotencyKey: 'request-key-1',
        viewer,
      },
      {
        authorizeHouseAction,
        clock: { now: () => new Date('2026-08-30T10:00:00.000Z') },
        ids: {
          generate() {
            const id = generatedIds.shift();
            if (id === undefined) throw new Error('Unexpected ID allocation');
            return id;
          },
        },
        tokens: { issue },
        invitations: { create },
      },
    );

    expect(authorizeHouseAction).toHaveBeenCalledWith(
      { kind: 'create_member_invite' },
      context.houseId,
      viewer,
    );
    expect(issue).toHaveBeenCalledWith({
      kind: 'idempotent',
      scope: `${viewer.userId}:${context.houseId}:request-key-1`,
    });
    expect(create).toHaveBeenCalledWith(context, {
      invitationId: '01941f29-7c00-7000-8000-000000000301',
      auditId: '01941f29-7c00-7000-8000-000000000302',
      command: { kind: 'shared' },
      tokenDigestHex: 'a'.repeat(64),
      createdAt: new Date('2026-08-30T10:00:00.000Z'),
    });
    expect(JSON.stringify(create.mock.calls)).not.toContain('raw-invitation-token');
    expect(result).toEqual({
      invitationId: '01941f29-7c00-7000-8000-000000000301',
      houseId: context.houseId,
      token: 'raw-invitation-token',
      expiresAt: new Date('2026-09-06T10:00:00.000Z'),
      useLimit: 23,
    });
  });
});
