import { describe, expect, it } from 'vitest';
import { createPuzzleMetricStubs } from './puzzle-metrics';

describe('BM-046 House Puzzle publication metric', () => {
  it('counts committed publications', () => {
    const metrics = createPuzzleMetricStubs();
    expect(metrics.snapshot()).toEqual({ puzzle_published_total: 0 });
    metrics.incrementPublished();
    metrics.incrementPublished();
    expect(metrics.snapshot()).toEqual({ puzzle_published_total: 2 });
  });
});
