import type { EmailDeliveryEventRepository, ResendDeliveryEvent } from '@between-moves/domain';
import { FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { recordResendDeliveryEvent } from './resend-webhook';

const event: ResendDeliveryEvent = {
  id: 'msg_123',
  type: 'email.delivered',
  emailId: 'email_123',
  occurredAt: new Date('2026-09-16T10:00:00.000Z'),
};

describe('recordResendDeliveryEvent', () => {
  it('[BM-030] [DR-DELIV-01] uses the provider event ID as the durable idempotency key', async () => {
    const repository: EmailDeliveryEventRepository = {
      record: vi.fn<EmailDeliveryEventRepository['record']>(async () => 'processed'),
    };
    const receivedAt = new Date('2026-09-16T10:01:00.000Z');

    await expect(
      recordResendDeliveryEvent(event, {
        clock: new FakeClock(receivedAt),
        repository,
      }),
    ).resolves.toBe('processed');
    expect(repository.record).toHaveBeenCalledWith(event, receivedAt);
  });

  it('[BM-030] returns duplicate without applying another effect', async () => {
    const repository: EmailDeliveryEventRepository = {
      record: vi.fn<EmailDeliveryEventRepository['record']>(async () => 'duplicate'),
    };

    await expect(
      recordResendDeliveryEvent(event, {
        clock: new FakeClock(event.occurredAt),
        repository,
      }),
    ).resolves.toBe('duplicate');
  });
});
