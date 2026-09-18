export interface RealtimeMetricSnapshot {
  readonly realtime_token_issue_total: number;
  readonly rate_limit_hit_total: number;
  readonly realtime_publish_delay_ms: readonly number[];
  readonly live_reconnect_total: number;
  readonly presence_count: number;
}

export interface RealtimeMetricStubs {
  incrementRealtimeTokenIssue(): void;
  incrementRateLimitHit(): void;
  observeRealtimePublishDelay(milliseconds: number): void;
  incrementLiveReconnect(): void;
  setPresenceCount(count: number): void;
  snapshot(): RealtimeMetricSnapshot;
}

/** [BM-037] [BM-038] In-process seam for token, publish delay, and reconnect counters. */
export function createRealtimeMetricStubs(): RealtimeMetricStubs {
  let tokenIssues = 0;
  let rateLimitHits = 0;
  let liveReconnects = 0;
  let presenceCount = 0;
  const publishDelays: number[] = [];
  return {
    incrementRealtimeTokenIssue() {
      tokenIssues += 1;
    },
    incrementRateLimitHit() {
      rateLimitHits += 1;
    },
    observeRealtimePublishDelay(milliseconds) {
      publishDelays.push(Math.max(0, milliseconds));
    },
    incrementLiveReconnect() {
      liveReconnects += 1;
    },
    setPresenceCount(count) {
      presenceCount = Math.max(0, Math.trunc(count));
    },
    snapshot() {
      return {
        realtime_token_issue_total: tokenIssues,
        rate_limit_hit_total: rateLimitHits,
        realtime_publish_delay_ms: [...publishDelays],
        live_reconnect_total: liveReconnects,
        presence_count: presenceCount,
      };
    },
  };
}
