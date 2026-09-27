import {
  INVITATION_EMAIL_TOPIC,
  type ClaimedOutboxEvent,
  type InvitationEmailDeliveryCodec,
  type InvitationEmailDeliveryGate,
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
  readonly invitations: InvitationEmailDeliveryGate;
  readonly sender: InvitationEmailSender;
}): OutboxConsumer {
  return {
    async consume(event) {
      const sealed = sealedPayload(event);
      const result = await dependencies.invitations.withDeliverableInvitation(
        event.aggregateId,
        async () => {
          const message = await dependencies.codec.open(sealed);
          return dependencies.sender.sendInvitation(message, { idempotencyKey: event.id });
        },
      );
      return result === 'duplicate' ? 'duplicate' : 'processed';
    },
  };
}
