import type {
  ClaimedOutboxEvent,
  MagicLinkDeliveryCodec,
  MagicLinkEmailSender,
  MagicLinkOutboxWriter,
} from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createMagicLinkDeliveryQueue, createMagicLinkEmailConsumer } from './magic-link';

const now = new Date('2026-08-29T14:00:00.000Z');
const id = '01941f29-7c00-7000-8000-000000000801';
const email = 'member@example.test';
const signInUrl = 'https://betweenmoves.test/api/auth/callback?token=raw-secret-token';

function codec(): MagicLinkDeliveryCodec {
  return {
    seal: vi.fn(async () => 'sealed-delivery-payload'),
    open: vi.fn(async () => ({ email, signInUrl })),
  };
}

describe('magic-link delivery application use cases', () => {
  it('[BM-008] [DR-ID-03] queues only a sealed magic-link payload through the outbox', async () => {
    const writer: MagicLinkOutboxWriter = { enqueue: vi.fn(async () => undefined) };
    const deliveryCodec = codec();
    const queue = createMagicLinkDeliveryQueue({
      clock: { now: () => now },
      generateId: () => id,
      codec: deliveryCodec,
      writer,
    });

    await queue({ email, signInUrl });

    expect(deliveryCodec.seal).toHaveBeenCalledWith({ email, signInUrl });
    expect(writer.enqueue).toHaveBeenCalledWith({
      id,
      topic: 'identity.magic-link-email.requested',
      aggregateId: id,
      sequence: 1n,
      houseId: null,
      payload: { sealed: 'sealed-delivery-payload' },
      availableAt: now,
      occurredAt: now,
    });
    const persisted = JSON.stringify(vi.mocked(writer.enqueue).mock.calls, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(persisted).not.toContain(email);
    expect(persisted).not.toContain('raw-secret-token');
  });

  it('[BM-008] sends a claimed magic-link event once through the email port', async () => {
    const deliveryCodec = codec();
    const sender: MagicLinkEmailSender = {
      sendMagicLink: vi.fn<MagicLinkEmailSender['sendMagicLink']>(async () => 'sent'),
    };
    const consumer = createMagicLinkEmailConsumer({ codec: deliveryCodec, sender });
    const event: ClaimedOutboxEvent = {
      id,
      topic: 'identity.magic-link-email.requested',
      aggregateId: id,
      sequence: 1n,
      houseId: null,
      payload: { sealed: 'sealed-delivery-payload' },
      attempts: 1,
      availableAt: now,
      occurredAt: now,
    };

    await expect(consumer.consume(event)).resolves.toBe('processed');
    expect(sender.sendMagicLink).toHaveBeenCalledWith({ email, signInUrl }, { idempotencyKey: id });
  });

  it('[BM-008] treats a provider-idempotent replay as a duplicate outbox delivery', async () => {
    const sender: MagicLinkEmailSender = {
      sendMagicLink: vi.fn<MagicLinkEmailSender['sendMagicLink']>(async () => 'duplicate'),
    };
    const consumer = createMagicLinkEmailConsumer({ codec: codec(), sender });
    const event = {
      id,
      topic: 'identity.magic-link-email.requested',
      aggregateId: id,
      sequence: 1n,
      houseId: null,
      payload: { sealed: 'sealed-delivery-payload' },
      attempts: 2,
      availableAt: now,
      occurredAt: now,
    } satisfies ClaimedOutboxEvent;

    await expect(consumer.consume(event)).resolves.toBe('duplicate');
  });
});
