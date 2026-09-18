import {
  CHAT_REALTIME_TOPICS,
  GAME_COMPLETED_TOPIC,
  GAME_MOVE_ACCEPTED_TOPIC,
  NIGHT_CHAT_DELETED_TOPIC,
  NIGHT_CHAT_POSTED_TOPIC,
  NIGHT_ENDED_TOPIC,
  NIGHT_STARTED_TOPIC,
  REALTIME_PUBLISH_TOPICS,
  type Clock,
  type OutboxConsumer,
  type RealtimeChannelResolver,
  type RealtimePublisher,
  type RealtimePublishMetrics,
} from '@between-moves/domain';

export const REALTIME_PUBLISH_TOPIC_SET: ReadonlySet<string> = new Set([
  ...REALTIME_PUBLISH_TOPICS,
  ...CHAT_REALTIME_TOPICS,
]);

export interface RealtimePublishConsumerDependencies {
  readonly clock: Clock;
  readonly publisher: RealtimePublisher;
  readonly channels: RealtimeChannelResolver;
  readonly metrics: RealtimePublishMetrics;
}

function isPublishableTopic(topic: string): boolean {
  return (
    topic === GAME_MOVE_ACCEPTED_TOPIC ||
    topic === GAME_COMPLETED_TOPIC ||
    topic === NIGHT_STARTED_TOPIC ||
    topic === NIGHT_ENDED_TOPIC ||
    topic === NIGHT_CHAT_POSTED_TOPIC ||
    topic === NIGHT_CHAT_DELETED_TOPIC
  );
}

/** [BM-038] [DR-DELIV-01] Publish sequenced Night/Game events; duplicates are provider-idempotent. */
export function createRealtimePublishConsumer(
  dependencies: RealtimePublishConsumerDependencies,
): OutboxConsumer {
  return {
    async consume(event) {
      if (!isPublishableTopic(event.topic)) return 'processed';
      if (event.houseId === null) {
        throw new Error('Realtime publish event is missing a House id');
      }
      const channel = dependencies.channels.channelFor(event);
      if (channel === null) {
        throw new Error('Realtime publish event did not resolve to an opaque channel');
      }
      const result = await dependencies.publisher.publish({
        eventId: event.id,
        channel,
        topic: event.topic,
        houseId: event.houseId,
        aggregateId: event.aggregateId,
        sequence: event.sequence,
        payload: event.payload,
        occurredAt: event.occurredAt,
      });
      const delayMs = Math.max(0, dependencies.clock.now().getTime() - event.occurredAt.getTime());
      try {
        dependencies.metrics.observeRealtimePublishDelay(delayMs);
      } catch {
        // A successful publish remains successful when metrics are unavailable.
      }
      return result === 'duplicate' ? 'duplicate' : 'processed';
    },
  };
}
