import type {
  Clock,
  EmailDeliveryEventRecordResult,
  EmailDeliveryEventRepository,
  ResendDeliveryEvent,
} from '@between-moves/domain';

export interface ResendDeliveryEventDependencies {
  readonly clock: Clock;
  readonly repository: EmailDeliveryEventRepository;
}

/** [BM-030] [DR-DELIV-01] Persists one effect per verified provider event ID. */
export function recordResendDeliveryEvent(
  event: ResendDeliveryEvent,
  dependencies: ResendDeliveryEventDependencies,
): Promise<EmailDeliveryEventRecordResult> {
  return dependencies.repository.record(event, dependencies.clock.now());
}
