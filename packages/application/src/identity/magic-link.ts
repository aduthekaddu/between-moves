import type {
  ClaimedOutboxEvent,
  Clock,
  MagicLinkDeliveryCodec,
  MagicLinkEmail,
  MagicLinkEmailSender,
  MagicLinkOutboxWriter,
  NewOutboxEvent,
  OutboxConsumer,
} from '@between-moves/domain';

export const MAGIC_LINK_EMAIL_TOPIC = 'identity.magic-link-email.requested';

export interface MagicLinkDeliveryQueueDependencies {
  readonly clock: Clock;
  readonly generateId: () => string;
  readonly codec: MagicLinkDeliveryCodec;
  readonly writer: MagicLinkOutboxWriter;
}

export type QueueMagicLinkDelivery = (message: MagicLinkEmail) => Promise<void>;

/** [BM-008] [DR-ID-03] Persists only a sealed email/link envelope through BM-006. */
export function createMagicLinkDeliveryQueue(
  dependencies: MagicLinkDeliveryQueueDependencies,
): QueueMagicLinkDelivery {
  return async (message) => {
    const now = dependencies.clock.now();
    const id = dependencies.generateId();
    const sealed = await dependencies.codec.seal(message);
    const event: NewOutboxEvent = {
      id,
      topic: MAGIC_LINK_EMAIL_TOPIC,
      aggregateId: id,
      sequence: 1n,
      houseId: null,
      payload: { sealed },
      availableAt: now,
      occurredAt: now,
    };
    await dependencies.writer.enqueue(event);
  };
}

function sealedPayload(event: ClaimedOutboxEvent): string {
  if (event.topic !== MAGIC_LINK_EMAIL_TOPIC || typeof event.payload.sealed !== 'string') {
    throw new Error('Invalid magic-link outbox event');
  }
  return event.payload.sealed;
}

/** [BM-008] Delivers at least once while the sender enforces event-id idempotency. */
export function createMagicLinkEmailConsumer(dependencies: {
  readonly codec: MagicLinkDeliveryCodec;
  readonly sender: MagicLinkEmailSender;
}): OutboxConsumer {
  return {
    async consume(event) {
      const message = await dependencies.codec.open(sealedPayload(event));
      const result = await dependencies.sender.sendMagicLink(message, {
        idempotencyKey: event.id,
      });
      return result === 'duplicate' ? 'duplicate' : 'processed';
    },
  };
}
