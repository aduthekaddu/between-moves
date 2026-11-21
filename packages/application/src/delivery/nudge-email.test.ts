import type {
  ClaimedOutboxEvent,
  NudgeEmailReader,
  NudgeEmailSender,
  NudgeMetrics,
} from '@between-moves/domain';
import { PermanentOutboxError } from '@between-moves/domain';
import { FakeClock } from '@between-moves/domain/testing';
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

function harness(send: NudgeEmailSender['sendNudge'], clock = new FakeClock(event.occurredAt)) {
  const reader: NudgeEmailReader = {
    readForDelivery: vi.fn(async () => ({
      email: 'member@example.test',
      houseId: '01941f29-7c00-7000-8000-000000000601',
      houseName: 'Knights at Dusk',
      gameId: event.aggregateId,
      ply: 7,
      stage: 'overdue' as const,
      opponentName: 'Bea',
      lastMoveSan: 'Nf3',
      moveDueAt: new Date('2026-09-15T00:00:00.000Z'),
    })),
  };
  const metrics: NudgeMetrics = {
    incrementNudgeEnqueue: vi.fn(),
    incrementNudgeSend: vi.fn(),
  };
  return {
    consumer: createNudgeEmailConsumer({ clock, reader, sender: { sendNudge: send }, metrics }),
    clock,
    metrics,
    reader,
  };
}

describe('Nudge email consumer', () => {
  it('[BM-029] [PR-JRN-06] sends with the durable outbox event ID as provider key', async () => {
    const send = vi.fn(async () => 'sent' as const);
    const { consumer, metrics, reader } = harness(send);

    await expect(consumer.consume(event)).resolves.toBe('processed');
    expect(reader.readForDelivery).toHaveBeenCalledWith(event);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'member@example.test', stage: 'overdue' }),
      { idempotencyKey: event.id },
    );
    expect(metrics.incrementNudgeSend).toHaveBeenCalledWith('overdue', 'success');
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
