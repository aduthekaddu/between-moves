import type {
  ClaimedOutboxEvent,
  OutboxConsumer,
  OutboxConsumeResult,
} from '@between-moves/domain';
import type { StructuredLogger } from '@between-moves/observability';

/** [BM-006] DR-DELIV-01/DR-SEC-06 skeleton consumer deduplicated by event ID. */
export class IdempotentLoggingConsumer implements OutboxConsumer {
  // Skeleton-only process-local dedupe; real consumers use durable provider/source unique keys.
  private readonly consumedEventIds = new Set<string>();

  constructor(private readonly logger: StructuredLogger) {}

  async consume(event: ClaimedOutboxEvent): Promise<OutboxConsumeResult> {
    if (this.consumedEventIds.has(event.id)) return 'duplicate';

    this.logger.log({
      level: 'info',
      requestId: event.id,
      actorId: 'anonymous',
      houseId: event.houseId,
      gameId: null,
      commandId: null,
      event: 'delivery.event-consumed',
      outcome: 'success',
      durationMs: 0,
      data: {
        event_id: event.id,
        topic: event.topic,
        aggregate_id: event.aggregateId,
        sequence: event.sequence,
      },
    });
    this.consumedEventIds.add(event.id);
    return 'processed';
  }
}
