import { describe, expect, it } from 'vitest';
import { createRealtimeMetricStubs } from './realtime-metrics';

describe('Realtime token metrics', () => {
  it('[BM-037] counts token issuance and rate-limit denials', () => {
    const metrics = createRealtimeMetricStubs();
    metrics.incrementRealtimeTokenIssue();
    metrics.incrementRealtimeTokenIssue();
    metrics.incrementRateLimitHit();
    expect(metrics.snapshot()).toEqual({
      realtime_token_issue_total: 2,
      rate_limit_hit_total: 1,
    });
  });
});
