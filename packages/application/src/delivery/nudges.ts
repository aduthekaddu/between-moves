import {
  NUDGE_DUE_TOPIC,
  type Clock,
  type DueNudge,
  type NudgeMetrics,
  type NudgeOutboxEvent,
  type NudgeRepository,
} from '@between-moves/domain';

export const DEFAULT_NUDGE_ADVANCE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_NUDGE_BATCH_SIZE = 100;

export interface NudgeDispatcherOptions {
  readonly clock: Clock;
  readonly generateId: () => string;
  readonly repository: NudgeRepository;
  readonly metrics: NudgeMetrics;
  readonly advanceWindowMs?: number;
  readonly batchSize?: number;
}

export interface NudgeDispatchSummary {
  readonly scanned: number;
  readonly enqueued: number;
  readonly duplicate: number;
}

export interface NudgeDispatcher {
  dispatch(): Promise<NudgeDispatchSummary>;
}

function eventFor(nudge: DueNudge, id: string, now: Date): NudgeOutboxEvent {
  return {
    id,
    topic: NUDGE_DUE_TOPIC,
    aggregateId: nudge.gameId,
    houseId: nudge.houseId,
    payload: {
      recipientMembershipId: nudge.recipientMembershipId,
      ply: nudge.ply,
      stage: nudge.stage,
    },
    availableAt: now,
    occurredAt: now,
  };
}

/** [BM-029] [DR-CORR-02/04] Scans deadlines without changing overdue Game state. */
export function createNudgeDispatcher(options: NudgeDispatcherOptions): NudgeDispatcher {
  const advanceWindowMs = options.advanceWindowMs ?? DEFAULT_NUDGE_ADVANCE_WINDOW_MS;
  const batchSize = options.batchSize ?? DEFAULT_NUDGE_BATCH_SIZE;
  if (!Number.isSafeInteger(advanceWindowMs) || advanceWindowMs <= 0) {
    throw new RangeError('Nudge advance window must be a positive integer');
  }
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new RangeError('Nudge batch size must be a positive integer');
  }

  return {
    async dispatch() {
      const now = options.clock.now();
      const due = await options.repository.findDue({
        now,
        advanceCutoff: new Date(now.getTime() + advanceWindowMs),
        limit: batchSize,
      });
      let enqueued = 0;
      let duplicate = 0;
      for (const nudge of due) {
        const inserted = await options.repository.enqueue(
          nudge,
          eventFor(nudge, options.generateId(), now),
        );
        options.metrics.incrementNudgeEnqueue(nudge.stage, inserted ? 'enqueued' : 'duplicate');
        if (inserted) enqueued += 1;
        else duplicate += 1;
      }
      return { scanned: due.length, enqueued, duplicate };
    },
  };
}
