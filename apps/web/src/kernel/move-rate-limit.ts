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

export type MoveRateLimit = AccountRateLimit;

/** [BM-024] [DR-SEC-04] Fail-open per-account and per-IP Move limiter. */
export function createMoveRateLimit(dependencies: AccountRateLimitDependencies): MoveRateLimit {
  return createAccountRateLimit(
    { scope: 'move', policy: POLICY, fallbackPolicy: FALLBACK_POLICY },
    dependencies,
  );
}
