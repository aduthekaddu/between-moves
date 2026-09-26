export interface AnalysisMetricSnapshot {
  readonly analysis_job_duration_ms: number;
  readonly analysis_job_failure_total: number;
}

/** [BM-044] In-process metric seam for completed job duration and failures. */
export function createAnalysisMetricStubs() {
  let durationMs = 0;
  let failures = 0;
  return {
    observeDuration(milliseconds: number) {
      durationMs = Math.max(0, milliseconds);
    },
    incrementFailure() {
      failures += 1;
    },
    snapshot(): AnalysisMetricSnapshot {
      return { analysis_job_duration_ms: durationMs, analysis_job_failure_total: failures };
    },
  };
}
