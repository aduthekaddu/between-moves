import {
  createAccountRateLimit,
  type AccountRateLimit,
  type AccountRateLimitDependencies,
} from './rate-limit';

const POLICY = {
  account: { limit: 10, windowSeconds: 60 },
  ip: { limit: 20, windowSeconds: 60 },
} as const;
const FALLBACK_POLICY = {
  account: { limit: 5, windowSeconds: 60 },
  ip: { limit: 10, windowSeconds: 60 },
} as const;

export type NoteRateLimit = AccountRateLimit;

/** [BM-032] [DR-SEC-04] Fail-open per-account and per-IP Game-note limiter. */
export function createNoteRateLimit(dependencies: AccountRateLimitDependencies): NoteRateLimit {
  return createAccountRateLimit(
    { scope: 'note', policy: POLICY, fallbackPolicy: FALLBACK_POLICY },
    dependencies,
  );
}
