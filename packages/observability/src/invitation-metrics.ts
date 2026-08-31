export type InvitationRateLimitMetricSurface = 'create' | 'inspect' | 'redeem';

export interface InvitationMetricSnapshot {
  readonly rate_limit_hit_total: Readonly<Record<InvitationRateLimitMetricSurface, number>>;
}

export interface InvitationMetricStubs {
  incrementRateLimitHit(surface: InvitationRateLimitMetricSurface): void;
  snapshot(): InvitationMetricSnapshot;
}

/** [BM-014] In-process Invitation metric seam preserving the required surface label. */
export function createInvitationMetricStubs(): InvitationMetricStubs {
  const rateLimit = { create: 0, inspect: 0, redeem: 0 };
  return {
    incrementRateLimitHit(surface) {
      rateLimit[surface] += 1;
    },
    snapshot() {
      return { rate_limit_hit_total: { ...rateLimit } };
    },
  };
}
