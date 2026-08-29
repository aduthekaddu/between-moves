import type { Clock } from '../shared/clock';

export const OUTBOX_MAX_ATTEMPTS = 8;

export interface NewOutboxEvent {
  readonly id: string;
  readonly topic: string;
  readonly aggregateId: string;
  readonly sequence: bigint;
  readonly houseId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly availableAt: Date;
  readonly occurredAt: Date;
}

export interface ClaimedOutboxEvent extends NewOutboxEvent {
  /** Incremented atomically when the lease is claimed. */
  readonly attempts: number;
}

export interface ClaimOutboxBatch {
  readonly now: Date;
  readonly leaseUntil: Date;
  readonly limit: number;
  readonly maxAttempts: number;
}

/** [BM-006] DR-DELIV-01 persistence port for lease-based at-least-once dispatch. */
export interface OutboxRepository {
  claimBatch(request: ClaimOutboxBatch): Promise<readonly ClaimedOutboxEvent[]>;
  markSent(eventId: string, sentAt: Date): Promise<void>;
  releaseForRetry(eventId: string, availableAt: Date): Promise<void>;
  markFailed(eventId: string, failedAt: Date): Promise<void>;
  oldestUnsentCreatedAt(): Promise<Date | null>;
}

export type OutboxConsumeResult = 'processed' | 'duplicate';

/** Every concrete consumer must deduplicate the outbox event ID. */
export interface OutboxConsumer {
  consume(event: ClaimedOutboxEvent): Promise<OutboxConsumeResult>;
}

export interface OutboxMetrics {
  setOutboxAgeSeconds(ageSeconds: number): void;
  incrementRealtimePublishRetry(): void;
}

export interface DeliveryPorts {
  readonly clock: Clock;
  readonly repository: OutboxRepository;
  readonly consumer: OutboxConsumer;
  readonly metrics: OutboxMetrics;
}
