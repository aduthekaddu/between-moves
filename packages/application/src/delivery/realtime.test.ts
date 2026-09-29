import type {
  ClaimedOutboxEvent,
  RealtimeChannelResolver,
  RealtimePublisher,
  RealtimePublishMetrics,
} from '@between-moves/domain';
import { FakeClock } from '@between-moves/domain/testing';
import { describe, expect, it, vi } from 'vitest';
import { createOutboxDispatcher } from './dispatcher';
import { createRealtimePublishConsumer } from './realtime';

const occurredAt = new Date('2026-09-04T14:00:00.000Z');
const now = new Date('2026-09-04T14:00:01.250Z');

function event(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: '01941f29-7c00-7000-8000-000000000501',
    topic: 'game.move-accepted',
    aggregateId: '01941f29-7c00-7000-8000-000000000801',
    sequence: 2n,
    houseId: '01941f29-7c00-7000-8000-000000000201',
    payload: { ply: 2, san: 'e5', fenAfter: '8/8/8/8/8/8/8/8 w - - 0 2', sideToMove: 'white' },
    attempts: 1,
    availableAt: now,
    occurredAt,
    ...overrides,
  };
}

function harness(publish: RealtimePublisher['publish'] = async () => 'published') {
  const publisher: RealtimePublisher = { publish: vi.fn(publish) };
  const channels: RealtimeChannelResolver = {
    channelFor: vi.fn(() => 'opaque-game-channel'),
  };
  const metrics: RealtimePublishMetrics = {
    observeRealtimePublishDelay: vi.fn(),
  };
  return {
    consumer: createRealtimePublishConsumer({
      clock: new FakeClock(now),
      publisher,
      channels,
      metrics,
    }),
    publisher,
    channels,
    metrics,
  };
}

describe('Realtime publish consumer', () => {
  it('[BM-038] publishes a sequenced Game event to an opaque channel', async () => {
    const { consumer, publisher, channels, metrics } = harness();
    const delivered = event();

    await expect(consumer.consume(delivered)).resolves.toBe('processed');
    expect(channels.channelFor).toHaveBeenCalledWith(delivered);
    expect(publisher.publish).toHaveBeenCalledWith({
      eventId: delivered.id,
      channel: 'opaque-game-channel',
      topic: 'game.move-accepted',
      houseId: delivered.houseId,
      aggregateId: delivered.aggregateId,
      sequence: 2n,
      payload: delivered.payload,
      occurredAt,
    });
    expect(metrics.observeRealtimePublishDelay).toHaveBeenCalledWith(1_250);
  });

  it('[BM-028] publishes draw offer changes to the Game channel', async () => {
    const { consumer, publisher } = harness();
    const delivered = event({
      topic: 'game.draw-offer-changed',
      sequence: 3n,
      payload: { change: 'declined', offeringMembershipId: 'membership-id', ply: 2 },
    });

    await expect(consumer.consume(delivered)).resolves.toBe('processed');
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'game.draw-offer-changed', sequence: 3n }),
    );
  });

  it('[BM-038] treats a provider-idempotent replay as a duplicate', async () => {
    const { consumer, publisher } = harness(async () => 'duplicate');

    await expect(consumer.consume(event())).resolves.toBe('duplicate');
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  it('[BM-038] leaves committed state to the outbox when publish fails', async () => {
    const { consumer, metrics } = harness(async () => {
      throw new Error('realtime provider unavailable');
    });

    await expect(consumer.consume(event())).rejects.toThrow('realtime provider unavailable');
    expect(metrics.observeRealtimePublishDelay).not.toHaveBeenCalled();
  });

  it('[BM-040] publishes a sequenced House chat event to an opaque Night channel', async () => {
    const { consumer, publisher, channels } = harness();
    const delivered = event({
      topic: 'night.chat-posted',
      aggregateId: '01941f29-7c00-7000-8000-000000000801',
      sequence: 1n,
      payload: {
        nightId: '01941f29-7c00-7000-8000-000000000901',
        messageId: '01941f29-7c00-7000-8000-000000000801',
        body: 'Hello from the rail',
        chatSequence: '1',
      },
    });

    await expect(consumer.consume(delivered)).resolves.toBe('processed');
    expect(channels.channelFor).toHaveBeenCalledWith(delivered);
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'night.chat-posted',
        aggregateId: delivered.aggregateId,
        payload: delivered.payload,
      }),
    );
  });

  it('[BM-038] skips topics that are not rail realtime events', async () => {
    const { consumer, publisher } = harness();

    await expect(consumer.consume(event({ topic: 'night.attendance-qualified' }))).resolves.toBe(
      'processed',
    );
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('[BM-038] retries a publish failure without marking the outbox event sent', async () => {
    const delivered = event();
    const { consumer } = harness(async () => {
      throw new Error('realtime provider unavailable');
    });
    const repository = {
      claimBatch: vi.fn(async () => [delivered]),
      markSent: vi.fn(async () => undefined),
      releaseForRetry: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      oldestUnsentCreatedAt: vi.fn(async () => delivered.occurredAt),
    };

    await expect(
      createOutboxDispatcher({
        repository,
        consumer,
        clock: new FakeClock(now),
        metrics: {
          setOutboxAgeSeconds: vi.fn(),
          incrementOutboxRetry: vi.fn(),
        },
      }).dispatchBatch(),
    ).resolves.toEqual({ claimed: 1, sent: 0, retried: 1, failed: 0 });
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(repository.releaseForRetry).toHaveBeenCalledOnce();
  });
});
