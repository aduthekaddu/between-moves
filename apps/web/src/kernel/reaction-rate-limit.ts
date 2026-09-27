import {
  createAccountRateLimit,
  type AccountRateLimit,
  type AccountRateLimitDependencies,
} from './rate-limit';

const POLICY = {
  account: { limit: 60, windowSeconds: 60 },
  ip: { limit: 120, windowSeconds: 60 },
} as const;
const FALLBACK_POLICY = {
  account: { limit: 30, windowSeconds: 60 },
  ip: { limit: 60, windowSeconds: 60 },
} as const;

export type ReactionRateLimit = AccountRateLimit;

/** [BM-031] [DR-SEC-04] Fail-open per-account and per-IP Reaction limiter. */
export function createReactionRateLimit(
  dependencies: AccountRateLimitDependencies,
): ReactionRateLimit {
  return createAccountRateLimit(
    { scope: 'reaction', policy: POLICY, fallbackPolicy: FALLBACK_POLICY },
    dependencies,
  );
}
