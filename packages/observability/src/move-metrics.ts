export interface MoveMetricSnapshot {
  readonly move_accept_latency_ms: readonly number[];
  readonly live_move_latency_ms: readonly number[];
  readonly live_flag_fall_total: number;
  readonly move_conflict_total: number;
  readonly rate_limit_hit_total: number;
}

export interface MoveMetricStubs {
  observeMoveAcceptLatency(milliseconds: number): void;
  observeLiveMoveLatency(milliseconds: number): void;
  incrementLiveFlagFall(): void;
  incrementMoveConflict(): void;
  incrementRateLimitHit(): void;
  snapshot(): MoveMetricSnapshot;
}

/** [BM-024] In-process seam for the required Move-path metrics. */
export function createMoveMetricStubs(): MoveMetricStubs {
  const latencies: number[] = [];
  const liveLatencies: number[] = [];
  let flags = 0;
  let conflicts = 0;
  let rateLimitHits = 0;
  return {
    observeMoveAcceptLatency(milliseconds) {
      latencies.push(Math.max(0, milliseconds));
    },
    observeLiveMoveLatency(milliseconds) {
      liveLatencies.push(Math.max(0, milliseconds));
    },
    incrementLiveFlagFall() {
      flags += 1;
    },
    incrementMoveConflict() {
      conflicts += 1;
    },
    incrementRateLimitHit() {
      rateLimitHits += 1;
    },
    snapshot() {
      return {
        move_accept_latency_ms: [...latencies],
        live_move_latency_ms: [...liveLatencies],
        live_flag_fall_total: flags,
        move_conflict_total: conflicts,
        rate_limit_hit_total: rateLimitHits,
      };
    },
  };
}
