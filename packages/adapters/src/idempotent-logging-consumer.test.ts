import type { ClaimedOutboxEvent } from '@between-moves/domain';
import { createStructuredLogger } from '@between-moves/observability';
import { describe, expect, it } from 'vitest';
import { IdempotentLoggingConsumer } from './idempotent-logging-consumer';

const fixedClock = { now: () => new Date('2026-08-29T10:00:00.000Z') };

function event(): ClaimedOutboxEvent {
  return {
    id: '01941f29-7c00-7000-8000-000000000201',
    topic: 'chat.posted',
    aggregateId: '01941f29-7c00-7000-8000-000000000202',
    sequence: 7n,
    houseId: '01941f29-7c00-7000-8000-000000000203',
    payload: { body: 'private House chat text' },
    attempts: 1,
    availableAt: fixedClock.now(),
    occurredAt: fixedClock.now(),
  };
}

describe('idempotent logging consumer', () => {
  it('[BM-006] DR-DELIV-01 DR-SEC-06 applies a duplicate event ID once without logging payload text', async () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({ clock: fixedClock, sink: (line) => lines.push(line) });
    const consumer = new IdempotentLoggingConsumer(logger);

    await expect(consumer.consume(event())).resolves.toBe('processed');
    await expect(consumer.consume(event())).resolves.toBe('duplicate');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('01941f29-7c00-7000-8000-000000000201');
    expect(lines[0]).not.toContain('private House chat text');
  });
});
