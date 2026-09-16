import type {
  ClaimedOutboxEvent,
  InvitationEmailDeliveryCodec,
  InvitationEmailSender,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createInvitationEmailConsumer } from './invitation-email';

const event: ClaimedOutboxEvent = {
  id: '01941f29-7c00-7000-8000-000000000101',
  topic: 'house.invitation-email.requested',
  aggregateId: '01941f29-7c00-7000-8000-000000000102',
  sequence: 1n,
  houseId: '01941f29-7c00-7000-8000-000000000103',
  payload: { sealed: 'sealed-payload' },
  attempts: 1,
  availableAt: new Date('2026-09-16T10:00:30.000Z'),
  occurredAt: new Date('2026-09-16T10:00:00.000Z'),
};

describe('Invitation email consumer', () => {
  it('[BM-030] opens and sends a queued Invitation using the event ID', async () => {
    const message = {
      email: 'friend@example.test',
      invitationUrl: 'https://betweenmoves.test/invitations/raw-token',
    };
    const codec: InvitationEmailDeliveryCodec = {
      seal: vi.fn(async () => 'unused'),
      open: vi.fn(async () => message),
    };
    const sender: InvitationEmailSender = {
      sendInvitation: vi.fn<InvitationEmailSender['sendInvitation']>(async () => 'sent'),
    };

    await expect(createInvitationEmailConsumer({ codec, sender }).consume(event)).resolves.toBe(
      'processed',
    );
    expect(codec.open).toHaveBeenCalledWith('sealed-payload');
    expect(sender.sendInvitation).toHaveBeenCalledWith(message, { idempotencyKey: event.id });
  });
});
