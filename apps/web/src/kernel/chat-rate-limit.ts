import {
  createAccountRateLimit,
  type AccountRateLimit,
  type AccountRateLimitDependencies,
} from './rate-limit';

const POLICY = {
  account: { limit: 20, windowSeconds: 60 },
  ip: { limit: 40, windowSeconds: 60 },
} as const;
const FALLBACK_POLICY = {
  account: { limit: 10, windowSeconds: 60 },
  ip: { limit: 20, windowSeconds: 60 },
} as const;

export type ChatRateLimit = AccountRateLimit;

/** [BM-040] [DR-SEC-04] Fail-open per-account and per-IP House-chat limiter. */
export function createChatRateLimit(dependencies: AccountRateLimitDependencies): ChatRateLimit {
  return createAccountRateLimit(
    { scope: 'chat', policy: POLICY, fallbackPolicy: FALLBACK_POLICY },
    dependencies,
  );
}
