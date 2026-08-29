import type { NewOutboxEvent } from '@between-moves/domain';
import type { Pool } from 'pg';

export type OutboxTransaction = Pick<Pool, 'query'>;

/** [BM-006] DR-DELIV-01 inserts an event through the caller's state-change transaction. */
export async function enqueueOutboxEvent(
  event: NewOutboxEvent,
  transaction: OutboxTransaction,
): Promise<void> {
  await transaction.query(
    `insert into outbox_events (
       id, topic, aggregate_id, sequence, house_id, payload, available_at, created_at
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      event.id,
      event.topic,
      event.aggregateId,
      event.sequence.toString(),
      event.houseId,
      JSON.stringify(event.payload),
      event.availableAt,
      event.occurredAt,
    ],
  );
}
