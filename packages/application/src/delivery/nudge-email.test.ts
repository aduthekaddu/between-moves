import type {
  ClaimedOutboxEvent,
  NudgeDeliveryGate,
  NudgeEmailSender,
  NudgeMetrics,
} from '@between-moves/domain';
import { PermanentOutboxError } from '@between-moves/domain';
import { FakeClock, fakeVerifiedNudgeDelivery } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { createNudgeEmailConsumer } from './nudge-email';

const event: ClaimedOutboxEvent = {
  id: '01941f29-7c00-7000-8000-000000000301',
  topic: 'nudge.due',
  aggregateId: '01941f29-7c00-7000-8000-000000000302',
  sequence: 8n,
  houseId: '01941f29-7c00-7000-8000-000000000303',
  payload: {
    recipientMembershipId: '01941f29-7c00-7000-8000-000000000304',
    ply: 7,
    stage: 'overdue',
  },
  attempts: 1,
  availableAt: new Date('2026-09-15T12:00:30.000Z'),
  occurredAt: new Date('2026-09-15T12:00:00.000Z'),
};

const delivery = fakeVerifiedNudgeDelivery({
  email: 'member@example.test',
  houseId: '01941f29-7c00-7000-8000-000000000601',
  houseName: 'Knights at Dusk',
  gameId: event.aggregateId,
  ply: 7,
  stage: 'overdue',
  opponentName: 'Bea',
  lastMoveSan: 'Nf3',
  moveDueAt: new Date('2026-09-15T00:00:00.000Z'),
});

function harness(
  send: NudgeEmailSender['sendNudge'],
  clock = new FakeClock(event.occurredAt),
  passed: typeof delivery | null = delivery,
) {
  const gate: NudgeDeliveryGate = { pass: vi.fn(async () => passed) };
  const metrics: NudgeMetrics = {
    incrementNudgeEnqueue: vi.fn(),
    incrementNudgeSend: vi.fn(),
  };
  return {
    consumer: createNudgeEmailConsumer({ clock, gate, sender: { sendNudge: send }, metrics }),
    clock,
    metrics,
    gate,
  };
}

describe('Nudge email consumer', () => {
  it('[BM-029] [PR-JRN-06] sends with the durable outbox event ID as provider key', async () => {
    const send = vi.fn(async () => 'sent' as const);
    const { consumer, metrics } = harness(send);

    await expect(consumer.consume(event)).resolves.toBe('processed');
    expect(send).toHaveBeenCalledWith(delivery, { idempotencyKey: event.id });
    expect(metrics.incrementNudgeSend).toHaveBeenCalledWith('overdue', 'success');
  });

  it('[BM-029] asks the gate with the clock at delivery, not at enqueue', async () => {
    const clock = new FakeClock(event.occurredAt);
    clock.advance(6 * 60 * 60 * 1_000);
    const { consumer, gate } = harness(async () => 'sent', clock);

    await consumer.consume(event);
    expect(gate.pass).toHaveBeenCalledWith(event, new Date('2026-09-15T18:00:00.000Z'));
  });

  it('[BM-029] settles a Nudge the gate refuses without calling the provider', async () => {
    const send = vi.fn(async () => 'sent' as const);
    const { consumer, metrics } = harness(send, undefined, null);

    await expect(consumer.consume(event)).resolves.toBe('processed');
    expect(send).not.toHaveBeenCalled();
    expect(metrics.incrementNudgeSend).toHaveBeenCalledWith('overdue', 'skipped');
  });

  it('[BM-029] [DR-DELIV-03] retains a send failure for outbox retry', async () => {
    const { consumer, metrics } = harness(async () => {
      throw new Error('email provider unavailable');
    });

    await expect(consumer.consume(event)).rejects.toThrow('email provider unavailable');
    expect(metrics.incrementNudgeSend).toHaveBeenCalledWith('overdue', 'failure');
  });

  it('[BM-029] [DR-CORR-04] treats provider-idempotent replay as a duplicate send', async () => {
    const { consumer, metrics } = harness(async () => 'duplicate');

    await expect(consumer.consume(event)).resolves.toBe('duplicate');
    expect(metrics.incrementNudgeSend).toHaveBeenCalledWith('overdue', 'duplicate');
  });

  it('[BM-029] never repeats an ambiguous send after provider idempotency expires', async () => {
    let effects = 0;
    const { consumer, clock, metrics } = harness(async () => {
      effects += 1;
      throw new Error('response lost after provider accepted email');
    });

    await expect(consumer.consume(event)).rejects.toThrow('response lost');
    clock.advance(24 * 60 * 60 * 1_000);
    await expect(consumer.consume(event)).rejects.toBeInstanceOf(PermanentOutboxError);
    expect(effects).toBe(1);
    expect(metrics.incrementNudgeSend).toHaveBeenLastCalledWith('overdue', 'failure');
  });
});
