import {
  NUDGE_DUE_TOPIC,
  PermanentOutboxError,
  type ClaimedOutboxEvent,
  type Clock,
  type NudgeDeliveryGate,
  type NudgeEmailSender,
  type NudgeMetrics,
  type NudgeStage,
  type OutboxConsumer,
} from '@between-moves/domain';

/** Resend retains idempotency keys for 24h; one hour is reserved for clock/queue skew. */
export const NUDGE_PROVIDER_RETRY_WINDOW_MS = 23 * 60 * 60 * 1_000;

function nudgeStage(event: ClaimedOutboxEvent): NudgeStage {
  const stage = event.payload.stage;
  if (event.topic !== NUDGE_DUE_TOPIC || (stage !== 'advance' && stage !== 'overdue')) {
    throw new Error('Invalid Nudge outbox event');
  }
  return stage;
}

/** [BM-029] [DR-DELIV-01/03] Delivers via provider-idempotent outbox event IDs. */
export function createNudgeEmailConsumer(dependencies: {
  readonly clock: Clock;
  readonly gate: NudgeDeliveryGate;
  readonly sender: NudgeEmailSender;
  readonly metrics: NudgeMetrics;
  readonly retryWindowMs?: number;
}): OutboxConsumer {
  const retryWindowMs = dependencies.retryWindowMs ?? NUDGE_PROVIDER_RETRY_WINDOW_MS;
  if (!Number.isSafeInteger(retryWindowMs) || retryWindowMs <= 0) {
    throw new RangeError('Nudge provider retry window must be a positive integer');
  }
  return {
    async consume(event) {
      const stage = nudgeStage(event);
      const now = dependencies.clock.now();
      if (now.getTime() - event.occurredAt.getTime() >= retryWindowMs) {
        dependencies.metrics.incrementNudgeSend(stage, 'failure');
        throw new PermanentOutboxError('Nudge provider idempotency window expired');
      }
      const delivery = await dependencies.gate.pass(event, now);
      if (delivery === null) {
        dependencies.metrics.incrementNudgeSend(stage, 'skipped');
        return 'processed';
      }
      try {
        const result = await dependencies.sender.sendNudge(delivery, {
          idempotencyKey: event.id,
        });
        dependencies.metrics.incrementNudgeSend(
          stage,
          result === 'duplicate' ? 'duplicate' : 'success',
        );
        return result === 'duplicate' ? 'duplicate' : 'processed';
      } catch (error) {
        dependencies.metrics.incrementNudgeSend(stage, 'failure');
        throw error;
      }
    },
  };
}
