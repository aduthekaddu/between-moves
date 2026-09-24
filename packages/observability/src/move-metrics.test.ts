import { describe, expect, it } from 'vitest';
import { createMoveMetricStubs } from './move-metrics';

describe('BM-024 Move metrics', () => {
  it('[BM-024] records acceptance latency, conflicts, and rate-limit hits', () => {
    const metrics = createMoveMetricStubs();
    metrics.observeMoveAcceptLatency(24);
    metrics.observeMoveAcceptLatency(-1);
    metrics.observeLiveMoveLatency(31);
    metrics.incrementLiveFlagFall();
    metrics.incrementMoveConflict();
    metrics.incrementRateLimitHit();

    expect(metrics.snapshot()).toEqual({
      move_accept_latency_ms: [24, 0],
      live_move_latency_ms: [31],
      live_flag_fall_total: 1,
      move_conflict_total: 1,
      rate_limit_hit_total: 1,
    });
  });
});
