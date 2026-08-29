import type { MagicLinkOutboxWriter, NewOutboxEvent } from '@between-moves/domain';
import type { Pool } from 'pg';
import { enqueueOutboxEvent } from './enqueue-outbox-event';

/** [BM-008] Persists a sealed delivery event as one atomic outbox insert. */
export class PgMagicLinkOutboxWriter implements MagicLinkOutboxWriter {
  constructor(private readonly database: Pick<Pool, 'query'>) {}

  async enqueue(event: NewOutboxEvent): Promise<void> {
    await enqueueOutboxEvent(event, this.database);
  }
}
