import {
  OUTBOX_MAX_ATTEMPTS,
  PermanentOutboxError,
  type ClaimedOutboxEvent,
  type DeliveryPorts,
  type OutboxConsumer,
  type OutboxMetrics,
  type OutboxRepository,
} from '@between-moves/domain';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 300_000;

export interface OutboxDispatcherOptions extends DeliveryPorts {
  readonly batchSize?: number;
  readonly leaseDurationMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly maxAttempts?: number;
}

export interface DispatchSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
}

export interface OutboxDispatcher {
  dispatchBatch(): Promise<DispatchSummary>;
  dispatchAvailable(maxBatches?: number): Promise<DispatchSummary>;
}

interface DispatcherConfig {
  readonly repository: OutboxRepository;
  readonly consumer: OutboxConsumer;
  readonly metrics: OutboxMetrics;
  readonly clock: DeliveryPorts['clock'];
  readonly batchSize: number;
  readonly leaseDurationMs: number;
  readonly retryBaseDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly maxAttempts: number;
}

function add(left: DispatchSummary, right: DispatchSummary): DispatchSummary {
  return {
    claimed: left.claimed + right.claimed,
    sent: left.sent + right.sent,
    retried: left.retried + right.retried,
    failed: left.failed + right.failed,
  };
}

function retryAt(event: ClaimedOutboxEvent, now: Date, config: DispatcherConfig): Date {
  const exponential = config.retryBaseDelayMs * 2 ** Math.max(0, event.attempts - 1);
  return new Date(now.getTime() + Math.min(exponential, config.retryMaxDelayMs));
}

async function recordOutboxAge(config: DispatcherConfig, now: Date): Promise<void> {
  const oldest = await config.repository.oldestUnsentCreatedAt();
  const age = oldest ? Math.max(0, (now.getTime() - oldest.getTime()) / 1_000) : 0;
  config.metrics.setOutboxAgeSeconds(age);
}

async function dispatchOne(
  event: ClaimedOutboxEvent,
  now: Date,
  config: DispatcherConfig,
): Promise<DispatchSummary> {
  try {
    await config.consumer.consume(event);
    await config.repository.markSent(event.id, now);
    return { claimed: 1, sent: 1, retried: 0, failed: 0 };
  } catch (error) {
    if (error instanceof PermanentOutboxError || event.attempts >= config.maxAttempts) {
      await config.repository.markFailed(event.id, now);
      return { claimed: 1, sent: 0, retried: 0, failed: 1 };
    }
    config.metrics.incrementRealtimePublishRetry();
    await config.repository.releaseForRetry(event.id, retryAt(event, now, config));
    return { claimed: 1, sent: 0, retried: 1, failed: 0 };
  }
}

/** [BM-006] DR-DELIV-01/03 orchestrates at-least-once delivery without concrete I/O. */
export function createOutboxDispatcher(options: OutboxDispatcherOptions): OutboxDispatcher {
  const config: DispatcherConfig = {
    repository: options.repository,
    consumer: options.consumer,
    metrics: options.metrics,
    clock: options.clock,
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    leaseDurationMs: options.leaseDurationMs ?? DEFAULT_LEASE_MS,
    retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS,
    retryMaxDelayMs: options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_MS,
    maxAttempts: options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS,
  };

  async function dispatchBatch(): Promise<DispatchSummary> {
    const now = config.clock.now();
    await recordOutboxAge(config, now);
    const events = await config.repository.claimBatch({
      now,
      leaseUntil: new Date(now.getTime() + config.leaseDurationMs),
      limit: config.batchSize,
      maxAttempts: config.maxAttempts,
    });
    let summary: DispatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0 };
    for (const event of events) summary = add(summary, await dispatchOne(event, now, config));
    return summary;
  }

  async function dispatchAvailable(maxBatches = 20): Promise<DispatchSummary> {
    let total: DispatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0 };
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const current = await dispatchBatch();
      total = add(total, current);
      if (current.claimed < config.batchSize) break;
    }
    return total;
  }

  return { dispatchBatch, dispatchAvailable };
}
