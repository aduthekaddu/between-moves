import { describe, expect, it } from 'vitest';
import { createDeliveryMetricStubs } from './delivery-metrics';

describe('delivery metric stubs', () => {
  it('[BM-006] [BM-029] exposes outbox and Nudge delivery metric values', () => {
    const metrics = createDeliveryMetricStubs();

    metrics.setOutboxAgeSeconds(42);
    metrics.incrementRealtimePublishRetry();
    metrics.incrementRealtimePublishRetry();
    metrics.incrementNudgeEnqueue('advance', 'enqueued');
    metrics.incrementNudgeEnqueue('advance', 'duplicate');
    metrics.incrementNudgeEnqueue('overdue', 'enqueued');
    metrics.incrementNudgeSend('advance', 'success');
    metrics.incrementNudgeSend('overdue', 'failure');
    metrics.incrementNudgeSend('overdue', 'duplicate');
    metrics.incrementNudgeSend('overdue', 'skipped');

    expect(metrics.snapshot()).toEqual({
      outbox_age_seconds: 42,
      realtime_publish_retry_total: 2,
      nudge_enqueue_total: {
        advance: { enqueued: 1, duplicate: 1 },
        overdue: { enqueued: 1, duplicate: 0 },
      },
      nudge_send_total: {
        advance: { success: 1, failure: 0, duplicate: 0, skipped: 0 },
        overdue: { success: 0, failure: 1, duplicate: 1, skipped: 1 },
      },
    });
  });
});
