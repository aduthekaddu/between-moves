import {
  INVITATION_EMAIL_TOPIC,
  type ClaimedOutboxEvent,
  type InvitationEmailDeliveryCodec,
  type InvitationEmailSender,
  type OutboxConsumer,
} from '@between-moves/domain';

function sealedPayload(event: ClaimedOutboxEvent): string {
  if (event.topic !== INVITATION_EMAIL_TOPIC || typeof event.payload.sealed !== 'string') {
    throw new Error('Invalid Invitation email outbox event');
  }
  return event.payload.sealed;
}

/** [BM-030] Delivers encrypted Invitation email with provider event-ID deduplication. */
export function createInvitationEmailConsumer(dependencies: {
  readonly codec: InvitationEmailDeliveryCodec;
  readonly sender: InvitationEmailSender;
}): OutboxConsumer {
  return {
    async consume(event) {
      const message = await dependencies.codec.open(sealedPayload(event));
      const result = await dependencies.sender.sendInvitation(message, {
        idempotencyKey: event.id,
      });
      return result === 'duplicate' ? 'duplicate' : 'processed';
    },
  };
}
