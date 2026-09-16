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
        invitationEmail: {
          codec: { seal: vi.fn(async () => 'sealed'), open: vi.fn() },
          buildUrl: vi.fn(),
        },
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
      deliveryEvent: null,
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

  it('[BM-030] atomically includes an encrypted delivery event for a restricted Invitation', async () => {
    const create = vi.fn(async (_context: typeof context, input: InvitationCreationInput) => ({
      invitationId: input.invitationId,
      houseId: context.houseId,
      expiresAt: new Date('2026-09-06T10:00:00.000Z'),
      useLimit: 1,
    }));
    const ids = [
      '01941f29-7c00-7000-8000-000000000401',
      '01941f29-7c00-7000-8000-000000000402',
      '01941f29-7c00-7000-8000-000000000403',
    ];
    const seal = vi.fn(async () => 'sealed-invitation');

    await createInvitation(
      {
        houseId: context.houseId,
        command: { kind: 'single', intendedEmail: ' Friend@Example.Test ' },
        idempotencyKey: null,
        viewer,
      },
      {
        authorizeHouseAction: vi.fn(async () => context),
        clock: { now: () => new Date('2026-08-30T10:00:00.000Z') },
        ids: { generate: () => ids.shift()! },
        tokens: { issue: () => ({ raw: 'raw-token', digestHex: 'b'.repeat(64) }) },
        invitations: { create },
        invitationEmail: {
          codec: { seal, open: vi.fn() },
          buildUrl: (token) => `https://betweenmoves.test/invitations/${token}`,
        },
      },
    );

    expect(seal).toHaveBeenCalledWith({
      email: 'friend@example.test',
      invitationUrl: 'https://betweenmoves.test/invitations/raw-token',
    });
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      invitationId: '01941f29-7c00-7000-8000-000000000401',
      auditId: '01941f29-7c00-7000-8000-000000000403',
      deliveryEvent: {
        id: '01941f29-7c00-7000-8000-000000000402',
        topic: 'house.invitation-email.requested',
        aggregateId: '01941f29-7c00-7000-8000-000000000401',
        payload: { sealed: 'sealed-invitation' },
      },
    });
    const persisted = JSON.stringify(create.mock.calls, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(persisted).not.toContain('raw-token');
    expect(persisted).not.toContain('friend@example.test');
  });
});
