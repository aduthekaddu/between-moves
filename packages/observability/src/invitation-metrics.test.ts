import { describe, expect, it } from 'vitest';
import { createInvitationMetricStubs } from './invitation-metrics';

describe('Invitation metrics', () => {
  it('[BM-014] records rate-limit hits by Invitation surface', () => {
    const metrics = createInvitationMetricStubs();
    metrics.incrementRateLimitHit('create');
    metrics.incrementRateLimitHit('inspect');
    metrics.incrementRateLimitHit('inspect');

    expect(metrics.snapshot()).toEqual({
      rate_limit_hit_total: { create: 1, inspect: 2 },
    });
  });
});
