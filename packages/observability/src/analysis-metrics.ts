export interface AnalysisMetricSnapshot {
  readonly analysis_job_duration_ms: number;
  readonly analysis_job_failure_total: number;
  readonly puzzle_candidate_created_total: number;
}

/** [BM-044] In-process metric seam for completed job duration and failures. */
export function createAnalysisMetricStubs() {
  let durationMs = 0;
  let failures = 0;
  let candidates = 0;
  return {
    observeDuration(milliseconds: number) {
      durationMs = Math.max(0, milliseconds);
    },
    incrementFailure() {
      failures += 1;
    },
    incrementCandidateCreated() {
      candidates += 1;
    },
    snapshot(): AnalysisMetricSnapshot {
      return {
        analysis_job_duration_ms: durationMs,
        analysis_job_failure_total: failures,
        puzzle_candidate_created_total: candidates,
      };
    },
  };
}
