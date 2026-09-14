import type { Clock } from '../shared/clock';

export const OUTBOX_MAX_ATTEMPTS = 8;

/** A retained delivery that must be parked instead of retried. */
export class PermanentOutboxError extends Error {
  override readonly name = 'PermanentOutboxError';
}

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

export const NUDGE_DUE_TOPIC = 'nudge.due';

export type NudgeStage = 'advance' | 'overdue';

export interface DueNudge {
  readonly gameId: string;
  readonly houseId: string;
  readonly ply: number;
  readonly recipientMembershipId: string;
  readonly stage: NudgeStage;
  readonly moveDueAt: Date;
}

export interface FindDueNudges {
  readonly now: Date;
  readonly advanceCutoff: Date;
  readonly limit: number;
}

export type NudgeOutboxEvent = Omit<NewOutboxEvent, 'sequence'>;

/** [BM-029] [DR-CORR-04] Natural-key-safe persistence for scheduled Nudges. */
export interface NudgeRepository {
  findDue(request: FindDueNudges): Promise<readonly DueNudge[]>;
  enqueue(nudge: DueNudge, event: NudgeOutboxEvent): Promise<boolean>;
}

export interface NudgeEmail {
  readonly email: string;
  readonly houseName: string;
  readonly gameId: string;
  readonly ply: number;
  readonly stage: NudgeStage;
}

export interface NudgeEmailReader {
  readForDelivery(event: ClaimedOutboxEvent): Promise<NudgeEmail | null>;
}

export type NudgeEmailSendResult = 'sent' | 'duplicate';

export interface NudgeEmailSender {
  sendNudge(
    message: NudgeEmail,
    options: { readonly idempotencyKey: string },
  ): Promise<NudgeEmailSendResult>;
}

export type NudgeEnqueueOutcome = 'enqueued' | 'duplicate';
export type NudgeSendOutcome = 'success' | 'failure' | 'duplicate' | 'skipped';

export interface NudgeMetrics {
  incrementNudgeEnqueue(stage: NudgeStage, outcome: NudgeEnqueueOutcome): void;
  incrementNudgeSend(stage: NudgeStage, outcome: NudgeSendOutcome): void;
}
