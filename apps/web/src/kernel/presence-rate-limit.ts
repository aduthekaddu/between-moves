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

export type PresenceRateLimit = AccountRateLimit;

/** [BM-039] Fail-open per-account and per-IP presence command limiter. */
export function createPresenceRateLimit(
  dependencies: AccountRateLimitDependencies,
): PresenceRateLimit {
  return createAccountRateLimit(
    { scope: 'presence', policy: POLICY, fallbackPolicy: FALLBACK_POLICY },
    dependencies,
  );
}
