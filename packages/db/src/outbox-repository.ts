import type { ClaimedOutboxEvent, ClaimOutboxBatch, OutboxRepository } from '@between-moves/domain';
import type { Pool, QueryResultRow } from 'pg';

interface OutboxRow extends QueryResultRow {
  id: string;
  topic: string;
  aggregate_id: string;
  sequence: string;
  house_id: string | null;
  payload: unknown;
  attempts: number;
  available_at: Date;
  created_at: Date;
}

type Queryable = Pick<Pool, 'query'>;

function parsePayload(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid outbox event row');
  }
  return value as Readonly<Record<string, unknown>>;
}

function parseRow(row: OutboxRow): ClaimedOutboxEvent {
  const sequence = BigInt(row.sequence);
  if (
    !row.id ||
    !row.topic ||
    !row.aggregate_id ||
    sequence < 0n ||
    !Number.isInteger(row.attempts) ||
    row.attempts < 1 ||
    !(row.available_at instanceof Date) ||
    !(row.created_at instanceof Date)
  ) {
    throw new Error('Invalid outbox event row');
  }
  return {
    id: row.id,
    topic: row.topic,
    aggregateId: row.aggregate_id,
    sequence,
    houseId: row.house_id,
    payload: parsePayload(row.payload),
    attempts: row.attempts,
    availableAt: row.available_at,
    occurredAt: row.created_at,
  };
}

/** [BM-006] PostgreSQL lease adapter using available_at and FOR UPDATE SKIP LOCKED. */
export class PgOutboxRepository implements OutboxRepository {
  constructor(private readonly database: Queryable) {}

  async claimBatch(request: ClaimOutboxBatch): Promise<readonly ClaimedOutboxEvent[]> {
    const result = await this.database.query<OutboxRow>(
      `with parked as (
         -- Recover a lease that crashed after claiming the final allowed attempt.
         update outbox_events
            set failed_at = $1
          where sent_at is null
            and failed_at is null
            and attempts >= $4
            and available_at <= $1
          returning id
       ), candidates as (
         select id
           from outbox_events
          where sent_at is null
            and failed_at is null
            and attempts < $4
            and available_at <= $1
          order by available_at, id
          for update skip locked
          limit $2
       )
       update outbox_events as event
          set attempts = event.attempts + 1,
              available_at = $3
         from candidates
        where event.id = candidates.id
      returning event.id, event.topic, event.aggregate_id,
                event.sequence::text, event.house_id, event.payload,
                event.attempts, event.available_at, event.created_at`,
      [request.now, request.limit, request.leaseUntil, request.maxAttempts],
    );
    return result.rows.map(parseRow);
  }

  async markSent(eventId: string, sentAt: Date): Promise<void> {
    await this.database.query(
      `update outbox_events set sent_at = $2
        where id = $1 and sent_at is null and failed_at is null`,
      [eventId, sentAt],
    );
  }

  async releaseForRetry(eventId: string, availableAt: Date): Promise<void> {
    await this.database.query(
      `update outbox_events set available_at = $2
        where id = $1 and sent_at is null and failed_at is null`,
      [eventId, availableAt],
    );
  }

  async markFailed(eventId: string, failedAt: Date): Promise<void> {
    await this.database.query(
      `update outbox_events set failed_at = $2
        where id = $1 and sent_at is null and failed_at is null`,
      [eventId, failedAt],
    );
  }

  async oldestUnsentCreatedAt(): Promise<Date | null> {
    const result = await this.database.query<{ oldest: Date | null }>(
      'select min(created_at) as oldest from outbox_events where sent_at is null',
    );
    const oldest = result.rows[0]?.oldest ?? null;
    if (oldest !== null && !(oldest instanceof Date)) throw new Error('Invalid outbox age row');
    return oldest;
  }
}
