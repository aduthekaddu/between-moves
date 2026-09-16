import { describe, expect, it } from 'vitest';
import { createDeliveryMetricStubs } from './delivery-metrics';

describe('delivery metric stubs', () => {
  it('[BM-006] [BM-029] [BM-030] exposes delivery metric values and email failure rate', () => {
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
    metrics.incrementEmailSend('success');
    metrics.incrementEmailSend('success');
    metrics.incrementEmailSend('failure');

    expect(metrics.snapshot()).toEqual({
      outbox_age_seconds: 42,
      realtime_publish_retry_total: 2,
      email_send_total: { success: 2, failure: 1 },
      email_failure_rate: 1 / 3,
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
