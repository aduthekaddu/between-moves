export interface RealtimeMetricSnapshot {
  readonly realtime_token_issue_total: number;
  readonly rate_limit_hit_total: number;
}

export interface RealtimeMetricStubs {
  incrementRealtimeTokenIssue(): void;
  incrementRateLimitHit(): void;
  snapshot(): RealtimeMetricSnapshot;
}

/** [BM-037] In-process seam for realtime_token_issue_total and rate-limit counters. */
export function createRealtimeMetricStubs(): RealtimeMetricStubs {
  let tokenIssues = 0;
  let rateLimitHits = 0;
  return {
    incrementRealtimeTokenIssue() {
      tokenIssues += 1;
    },
    incrementRateLimitHit() {
      rateLimitHits += 1;
    },
    snapshot() {
      return {
        realtime_token_issue_total: tokenIssues,
        rate_limit_hit_total: rateLimitHits,
      };
    },
  };
}
