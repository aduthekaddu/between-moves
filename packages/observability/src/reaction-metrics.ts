export interface ReactionMetricSnapshot {
  readonly reaction_set_total: number;
  readonly rate_limit_hit_total: number;
}

export interface ReactionMetricStubs {
  incrementReactionSet(): void;
  incrementRateLimitHit(): void;
  snapshot(): ReactionMetricSnapshot;
}

/** [BM-031] In-process seam for Reaction and Reaction rate-limit counters. */
export function createReactionMetricStubs(): ReactionMetricStubs {
  let reactionSets = 0;
  let rateLimitHits = 0;
  return {
    incrementReactionSet() {
      reactionSets += 1;
    },
    incrementRateLimitHit() {
      rateLimitHits += 1;
    },
    snapshot() {
      return { reaction_set_total: reactionSets, rate_limit_hit_total: rateLimitHits };
    },
  };
}
