import { describe, expect, it } from 'vitest';
import { createRateLimitMetricStubs } from './rate-limit-metrics';

describe('security rate-limit metrics', () => {
  it('[BM-051:AC-2] counts denials by bounded surface without user labels', () => {
    const metrics = createRateLimitMetricStubs();
    metrics.incrementRateLimitHit('move');
    metrics.incrementRateLimitHit('invitation-redeem');
    metrics.incrementRateLimitHit('invitation-redeem');
    expect(metrics.snapshot().rate_limit_hit_total).toMatchObject({
      move: 1,
      'invitation-redeem': 2,
      reaction: 0,
    });
    expect(Object.keys(metrics.snapshot().rate_limit_hit_total)).toHaveLength(11);
  });
});
