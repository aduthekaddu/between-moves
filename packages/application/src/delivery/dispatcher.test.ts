import {
  PermanentOutboxError,
  type ClaimedOutboxEvent,
  type OutboxConsumer,
  type OutboxMetrics,
  type OutboxRepository,
} from '@between-moves/domain';
import { FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { createOutboxDispatcher } from './dispatcher';

const NOW = new Date('2026-08-29T10:00:00.000Z');

function event(attempts = 1): ClaimedOutboxEvent {
  return {
    id: '01941f29-7c00-7000-8000-000000000101',
    topic: 'game.move-accepted',
    aggregateId: '01941f29-7c00-7000-8000-000000000102',
    sequence: 1n,
    houseId: '01941f29-7c00-7000-8000-000000000103',
    payload: { privateText: 'must-never-be-logged' },
    attempts,
    availableAt: new Date(NOW.getTime() + 30_000),
    occurredAt: new Date(NOW.getTime() - 30_000),
  };
}

function harness(claimed: ClaimedOutboxEvent, consume: OutboxConsumer['consume']) {
  let nextBatch: readonly ClaimedOutboxEvent[] = [claimed];
  const repository: OutboxRepository = {
    claimBatch: vi.fn(async () => {
      const batch = nextBatch;
      nextBatch = [];
      return batch;
    }),
    markSent: vi.fn(async () => undefined),
    releaseForRetry: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    oldestUnsentCreatedAt: vi.fn(async () => claimed.occurredAt),
  };
  const metrics: OutboxMetrics = {
    setOutboxAgeSeconds: vi.fn(),
    incrementRealtimePublishRetry: vi.fn(),
  };
  const dispatcher = createOutboxDispatcher({
    repository,
    consumer: { consume },
    clock: new FakeClock(NOW),
    metrics,
    batchSize: 10,
    leaseDurationMs: 30_000,
    retryBaseDelayMs: 1_000,
    maxAttempts: 8,
  });

  return { dispatcher, repository, metrics };
}

describe('outbox dispatcher', () => {
  it('[BM-006] DR-DELIV-01 dispatches a claimed event and marks it sent', async () => {
    const consume = vi.fn(async () => 'processed' as const);
    const { dispatcher, repository, metrics } = harness(event(), consume);

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
    });
    expect(consume).toHaveBeenCalledOnce();
    expect(repository.markSent).toHaveBeenCalledWith('01941f29-7c00-7000-8000-000000000101', NOW);
    expect(metrics.setOutboxAgeSeconds).toHaveBeenCalledWith(30);
  });

  it('[BM-006] DR-DELIV-03 retries a consumer error with exponential backoff', async () => {
    const { dispatcher, repository, metrics } = harness(event(1), async () => {
      throw new Error('provider unavailable');
    });

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      sent: 0,
      retried: 1,
      failed: 0,
    });
    expect(repository.releaseForRetry).toHaveBeenCalledWith(
      '01941f29-7c00-7000-8000-000000000101',
      new Date('2026-08-29T10:00:01.000Z'),
    );
    expect(metrics.incrementRealtimePublishRetry).toHaveBeenCalledOnce();
  });

  it('[BM-006] DR-DELIV-03 parks an event after its eighth failed attempt', async () => {
    const { dispatcher, repository } = harness(event(8), async () => {
      throw new Error('poison event');
    });

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      sent: 0,
      retried: 0,
      failed: 1,
    });
    expect(repository.markFailed).toHaveBeenCalledWith('01941f29-7c00-7000-8000-000000000101', NOW);
    expect(repository.releaseForRetry).not.toHaveBeenCalled();
  });

  it('[BM-029] parks a permanent provider failure without retrying', async () => {
    const { dispatcher, repository } = harness(event(1), async () => {
      throw new PermanentOutboxError('provider dedupe window expired');
    });

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      sent: 0,
      retried: 0,
      failed: 1,
    });
    expect(repository.markFailed).toHaveBeenCalledWith('01941f29-7c00-7000-8000-000000000101', NOW);
    expect(repository.releaseForRetry).not.toHaveBeenCalled();
  });

  it('[BM-006] DR-DELIV-01 applies a redelivered event effect only once', async () => {
    const redelivered = event();
    const seen = new Set<string>();
    let effectCount = 0;
    const repository: OutboxRepository = {
      claimBatch: vi.fn(async () => [redelivered]),
      markSent: vi.fn(async () => undefined),
      releaseForRetry: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      oldestUnsentCreatedAt: vi.fn(async () => redelivered.occurredAt),
    };
    const consumer: OutboxConsumer = {
      async consume(delivered) {
        if (seen.has(delivered.id)) return 'duplicate';
        seen.add(delivered.id);
        effectCount += 1;
        return 'processed';
      },
    };
    const dispatcher = createOutboxDispatcher({
      repository,
      consumer,
      clock: new FakeClock(NOW),
      metrics: {
        setOutboxAgeSeconds: vi.fn(),
        incrementRealtimePublishRetry: vi.fn(),
      },
    });

    await dispatcher.dispatchBatch();
    await dispatcher.dispatchBatch();

    expect(effectCount).toBe(1);
    expect(repository.markSent).toHaveBeenCalledTimes(2);
  });
});
