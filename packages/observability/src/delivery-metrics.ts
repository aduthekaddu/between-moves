export interface DeliveryMetricSnapshot {
  readonly outbox_age_seconds: number;
  readonly realtime_publish_retry_total: number;
  readonly nudge_enqueue_total: Readonly<
    Record<'advance' | 'overdue', Readonly<Record<'enqueued' | 'duplicate', number>>>
  >;
  readonly nudge_send_total: Readonly<
    Record<
      'advance' | 'overdue',
      Readonly<Record<'success' | 'failure' | 'duplicate' | 'skipped', number>>
    >
  >;
}

export interface DeliveryMetricStubs {
  setOutboxAgeSeconds(ageSeconds: number): void;
  incrementRealtimePublishRetry(): void;
  incrementNudgeEnqueue(stage: 'advance' | 'overdue', outcome: 'enqueued' | 'duplicate'): void;
  incrementNudgeSend(
    stage: 'advance' | 'overdue',
    outcome: 'success' | 'failure' | 'duplicate' | 'skipped',
  ): void;
  snapshot(): DeliveryMetricSnapshot;
}

/** [BM-006] Operations §4.2 metric seam until the production exporter is wired. */
export function createDeliveryMetricStubs(): DeliveryMetricStubs {
  let outboxAgeSeconds = 0;
  let realtimePublishRetryTotal = 0;
  const nudgeEnqueue = {
    advance: { enqueued: 0, duplicate: 0 },
    overdue: { enqueued: 0, duplicate: 0 },
  };
  const nudgeSend = {
    advance: { success: 0, failure: 0, duplicate: 0, skipped: 0 },
    overdue: { success: 0, failure: 0, duplicate: 0, skipped: 0 },
  };

  return {
    setOutboxAgeSeconds(ageSeconds) {
      outboxAgeSeconds = Math.max(0, ageSeconds);
    },
    incrementRealtimePublishRetry() {
      realtimePublishRetryTotal += 1;
    },
    incrementNudgeEnqueue(stage, outcome) {
      nudgeEnqueue[stage][outcome] += 1;
    },
    incrementNudgeSend(stage, outcome) {
      nudgeSend[stage][outcome] += 1;
    },
    snapshot() {
      return {
        outbox_age_seconds: outboxAgeSeconds,
        realtime_publish_retry_total: realtimePublishRetryTotal,
        nudge_enqueue_total: {
          advance: { ...nudgeEnqueue.advance },
          overdue: { ...nudgeEnqueue.overdue },
        },
        nudge_send_total: {
          advance: { ...nudgeSend.advance },
          overdue: { ...nudgeSend.overdue },
        },
      };
    },
  };
}
