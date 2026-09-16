import {
  INVITATION_EMAIL_TOPIC,
  NUDGE_DUE_TOPIC,
  PermanentOutboxError,
  type Clock,
  type OutboxConsumer,
} from '@between-moves/domain';
import { MAGIC_LINK_EMAIL_TOPIC } from '../identity/magic-link';

export interface EmailDeliveryConsumers {
  readonly clock: Clock;
  readonly magicLink: OutboxConsumer;
  readonly invitation: OutboxConsumer;
  readonly nudge: OutboxConsumer;
  readonly retryWindowMs?: number;
}

/** Resend keeps idempotency keys for 24h; reserve one hour for queue/clock skew. */
export const EMAIL_PROVIDER_RETRY_WINDOW_MS = 23 * 60 * 60 * 1_000;

/** [BM-030] [DR-DELIV-01] Routes every email event through one outbox consumer seam. */
export function createEmailDeliveryConsumer(consumers: EmailDeliveryConsumers): OutboxConsumer {
  const retryWindowMs = consumers.retryWindowMs ?? EMAIL_PROVIDER_RETRY_WINDOW_MS;
  if (!Number.isSafeInteger(retryWindowMs) || retryWindowMs <= 0) {
    throw new RangeError('Email provider retry window must be a positive integer');
  }
  return {
    async consume(event) {
      if (consumers.clock.now().getTime() - event.occurredAt.getTime() >= retryWindowMs) {
        throw new PermanentOutboxError('Email provider idempotency window expired');
      }
      switch (event.topic) {
        case MAGIC_LINK_EMAIL_TOPIC:
          return consumers.magicLink.consume(event);
        case INVITATION_EMAIL_TOPIC:
          return consumers.invitation.consume(event);
        case NUDGE_DUE_TOPIC:
          return consumers.nudge.consume(event);
        default:
          throw new Error(`Unsupported email outbox topic: ${event.topic}`);
      }
    },
  };
}
