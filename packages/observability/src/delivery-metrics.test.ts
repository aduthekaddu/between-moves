import { describe, expect, it } from 'vitest';
import { createDeliveryMetricStubs } from './delivery-metrics';

describe('delivery metric stubs', () => {
  it('[BM-006] exposes outbox_age_seconds and realtime_publish_retry_total values', () => {
    const metrics = createDeliveryMetricStubs();

    metrics.setOutboxAgeSeconds(42);
    metrics.incrementRealtimePublishRetry();
    metrics.incrementRealtimePublishRetry();

    expect(metrics.snapshot()).toEqual({
      outbox_age_seconds: 42,
      realtime_publish_retry_total: 2,
    });
  });
});
