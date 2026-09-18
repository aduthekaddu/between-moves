import { describe, expect, it } from 'vitest';
import { createRealtimeMetricStubs } from './realtime-metrics';

describe('Realtime token metrics', () => {
  it('[BM-037] [BM-038] counts token issuance, publish delay, and reconnects', () => {
    const metrics = createRealtimeMetricStubs();
    metrics.incrementRealtimeTokenIssue();
    metrics.incrementRealtimeTokenIssue();
    metrics.incrementRateLimitHit();
    metrics.observeRealtimePublishDelay(12);
    metrics.observeRealtimePublishDelay(40);
    metrics.incrementLiveReconnect();
    expect(metrics.snapshot()).toEqual({
      realtime_token_issue_total: 2,
      rate_limit_hit_total: 1,
      realtime_publish_delay_ms: [12, 40],
      live_reconnect_total: 1,
    });
  });
});
