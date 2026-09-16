import { describe, expect, it } from 'vitest';
import { createNoteMetricStubs } from './note-metrics';

describe('Game note metrics', () => {
  it('[BM-032] counts successful saves and rate-limit denials', () => {
    const metrics = createNoteMetricStubs();
    metrics.incrementNoteSave();
    metrics.incrementNoteSave();
    metrics.incrementRateLimitHit();
    expect(metrics.snapshot()).toEqual({ note_save_total: 2, rate_limit_hit_total: 1 });
  });
});
