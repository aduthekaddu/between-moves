import type { ClaimedOutboxEvent, OutboxConsumer } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '@between-moves/domain/testing';
import { createEmailDeliveryConsumer } from './email';

function event(topic: string): ClaimedOutboxEvent {
  return {
    id: '01941f29-7c00-7000-8000-000000000101',
    topic,
    aggregateId: '01941f29-7c00-7000-8000-000000000102',
    sequence: 1n,
    houseId: null,
    payload: {},
    attempts: 1,
    availableAt: new Date('2026-09-16T10:00:30.000Z'),
    occurredAt: new Date('2026-09-16T10:00:00.000Z'),
  };
}

function consumer(result: 'processed' | 'duplicate' = 'processed'): OutboxConsumer {
  return { consume: vi.fn(async () => result) };
}

const clock = new FakeClock(new Date('2026-09-16T10:01:00.000Z'));

describe('email delivery consumer', () => {
  it.each([
    ['identity.magic-link-email.requested', 'magicLink'],
    ['house.invitation-email.requested', 'invitation'],
    ['nudge.due', 'nudge'],
  ] as const)('[BM-030] [DR-DELIV-01] routes %s once to %s', async (topic, selected) => {
    const consumers = {
      clock,
      magicLink: consumer(),
      invitation: consumer(),
      nudge: consumer('duplicate'),
    };
    const delivery = createEmailDeliveryConsumer(consumers);

    await expect(delivery.consume(event(topic))).resolves.toBe(
      selected === 'nudge' ? 'duplicate' : 'processed',
    );
    expect(consumers[selected].consume).toHaveBeenCalledOnce();
    for (const name of ['magicLink', 'invitation', 'nudge'] as const) {
      if (name !== selected) expect(consumers[name].consume).not.toHaveBeenCalled();
    }
  });

  it('[BM-030] rejects a non-email event instead of swallowing another consumer topic', async () => {
    const delivery = createEmailDeliveryConsumer({
      clock,
      magicLink: consumer(),
      invitation: consumer(),
      nudge: consumer(),
    });

    await expect(delivery.consume(event('game.completed'))).rejects.toThrow(
      'Unsupported email outbox topic',
    );
  });

  it('[BM-030] parks email older than the provider idempotency window without sending', async () => {
    const magicLink = consumer();
    const delivery = createEmailDeliveryConsumer({
      clock,
      magicLink,
      invitation: consumer(),
      nudge: consumer(),
      retryWindowMs: 1_000,
    });

    await expect(delivery.consume(event('identity.magic-link-email.requested'))).rejects.toThrow(
      'Email provider idempotency window expired',
    );
    expect(magicLink.consume).not.toHaveBeenCalled();
  });
});
