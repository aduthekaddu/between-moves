import {
  createAccountRateLimit,
  type AccountRateLimit,
  type AccountRateLimitDependencies,
} from './rate-limit';

const POLICY = {
  account: { limit: 30, windowSeconds: 60 },
  ip: { limit: 60, windowSeconds: 60 },
} as const;
const FALLBACK_POLICY = {
  account: { limit: 15, windowSeconds: 60 },
  ip: { limit: 30, windowSeconds: 60 },
} as const;

export type RealtimeTokenRateLimit = AccountRateLimit;

/** [BM-037] [DR-SEC-04] Fail-open per-account and per-IP realtime token limiter. */
export function createRealtimeTokenRateLimit(
  dependencies: AccountRateLimitDependencies,
): RealtimeTokenRateLimit {
  return createAccountRateLimit(
    { scope: 'realtime-token', policy: POLICY, fallbackPolicy: FALLBACK_POLICY },
    dependencies,
  );
}
