import { describe, expect, it } from 'vitest';
import { createAnalysisMetricStubs } from './analysis-metrics';

describe('BM-044 analysis metrics', () => {
  it('records completed job duration and failure count', () => {
    const metrics = createAnalysisMetricStubs();
    metrics.observeDuration(1_250);
    metrics.incrementFailure();
    metrics.incrementFailure();
    expect(metrics.snapshot()).toEqual({
      analysis_job_duration_ms: 1_250,
      analysis_job_failure_total: 2,
    });
  });
});
