export type SecurityRateLimitSurface =
  | 'signin'
  | 'recovery'
  | 'invitation-create'
  | 'invitation-inspect'
  | 'invitation-redeem'
  | 'move'
  | 'house-chat'
  | 'reaction'
  | 'game-note'
  | 'realtime-token'
  | 'presence';

export interface RateLimitMetricStubs {
  incrementRateLimitHit(surface: SecurityRateLimitSurface): void;
  snapshot(): { readonly rate_limit_hit_total: Readonly<Record<SecurityRateLimitSurface, number>> };
}

/** [BM-051:AC-2] Bounded surface labels; no account or request content enters metrics. */
export function createRateLimitMetricStubs(): RateLimitMetricStubs {
  const hits: Record<SecurityRateLimitSurface, number> = {
    signin: 0,
    recovery: 0,
    'invitation-create': 0,
    'invitation-inspect': 0,
    'invitation-redeem': 0,
    move: 0,
    'house-chat': 0,
    reaction: 0,
    'game-note': 0,
    'realtime-token': 0,
    presence: 0,
  };
  return {
    incrementRateLimitHit(surface) {
      hits[surface] += 1;
    },
    snapshot() {
      return { rate_limit_hit_total: { ...hits } };
    },
  };
}
