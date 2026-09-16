import { SystemClock } from '@between-moves/adapters';
import { recordResendDeliveryEvent } from '@between-moves/application';
import { PgEmailDeliveryEventRepository } from '@between-moves/db';
import type { ResendDeliveryEvent } from '@between-moves/domain';
import { getDatabase } from './database';

const clock = new SystemClock();

/** [BM-030] Web composition for durable Resend webhook idempotency. */
export function recordEmailDeliveryEvent(event: ResendDeliveryEvent) {
  return recordResendDeliveryEvent(event, {
    clock,
    repository: new PgEmailDeliveryEventRepository(getDatabase().pool),
  });
}
