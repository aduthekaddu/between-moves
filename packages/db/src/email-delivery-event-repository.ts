import type {
  EmailDeliveryEventRecordResult,
  EmailDeliveryEventRepository,
  ResendDeliveryEvent,
} from '@between-moves/domain';
import type { Pool } from 'pg';

/** [BM-030] Stores only delivery metadata; provider payload bodies and email PII are discarded. */
export class PgEmailDeliveryEventRepository implements EmailDeliveryEventRepository {
  constructor(private readonly database: Pick<Pool, 'query'>) {}

  async record(
    event: ResendDeliveryEvent,
    receivedAt: Date,
  ): Promise<EmailDeliveryEventRecordResult> {
    const result = await this.database.query(
      `insert into email_delivery_events (id, event_type, email_id, occurred_at, received_at)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do nothing
       returning id`,
      [event.id, event.type, event.emailId, event.occurredAt, receivedAt],
    );
    return result.rowCount === 0 ? 'duplicate' : 'processed';
  }
}
