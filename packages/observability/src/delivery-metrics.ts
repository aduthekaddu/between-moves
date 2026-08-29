export interface DeliveryMetricSnapshot {
  readonly outbox_age_seconds: number;
  readonly realtime_publish_retry_total: number;
}

export interface DeliveryMetricStubs {
  setOutboxAgeSeconds(ageSeconds: number): void;
  incrementRealtimePublishRetry(): void;
  snapshot(): DeliveryMetricSnapshot;
}

/** [BM-006] Operations §4.2 metric seam until the production exporter is wired. */
export function createDeliveryMetricStubs(): DeliveryMetricStubs {
  let outboxAgeSeconds = 0;
  let realtimePublishRetryTotal = 0;

  return {
    setOutboxAgeSeconds(ageSeconds) {
      outboxAgeSeconds = Math.max(0, ageSeconds);
    },
    incrementRealtimePublishRetry() {
      realtimePublishRetryTotal += 1;
    },
    snapshot() {
      return {
        outbox_age_seconds: outboxAgeSeconds,
        realtime_publish_retry_total: realtimePublishRetryTotal,
      };
    },
  };
}
