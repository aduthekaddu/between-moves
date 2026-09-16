import { describe, expect, it } from 'vitest';
import { createReactionMetricStubs } from './reaction-metrics';

describe('BM-031 Reaction metrics', () => {
  it('[BM-031] records successful Reaction sets and rate-limit hits', () => {
    const metrics = createReactionMetricStubs();
    metrics.incrementReactionSet();
    metrics.incrementReactionSet();
    metrics.incrementRateLimitHit();

    expect(metrics.snapshot()).toEqual({ reaction_set_total: 2, rate_limit_hit_total: 1 });
  });
});
