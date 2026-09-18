import type { RateLimitInput, RateLimiter, RateLimitResult } from '@between-moves/domain';
import { createHash } from 'node:crypto';

const POLICY = {
  account: { limit: 60, windowSeconds: 60 },
  ip: { limit: 120, windowSeconds: 60 },
} as const;
const FALLBACK_POLICY = {
  account: { limit: 30, windowSeconds: 60 },
  ip: { limit: 60, windowSeconds: 60 },
} as const;

export interface PresenceRateLimitDependencies {
  readonly primary: RateLimiter;
  readonly fallback: RateLimiter;
  readonly incrementRateLimitHit: () => void;
  readonly onStoreError: () => void;
}

export type PresenceRateLimit = (request: Request, accountId: string) => Promise<RateLimitResult>;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function checks(
  request: Request,
  accountId: string,
  policy: typeof POLICY | typeof FALLBACK_POLICY,
): readonly RateLimitInput[] {
  return [
    { key: `presence:account:${digest(accountId)}`, policy: policy.account },
    { key: `presence:ip:${digest(clientIp(request))}`, policy: policy.ip },
  ];
}

async function evaluate(limiter: RateLimiter, inputs: readonly RateLimitInput[]) {
  const settled = await Promise.allSettled(inputs.map((input) => limiter.limit(input)));
  return {
    failures: settled.filter((result) => result.status === 'rejected').length,
    denied: settled.flatMap((result) =>
      result.status === 'fulfilled' && !result.value.allowed ? [result.value] : [],
    ),
  };
}

/** [BM-039] Fail-open per-account and per-IP presence command limiter. */
export function createPresenceRateLimit(
  dependencies: PresenceRateLimitDependencies,
): PresenceRateLimit {
  return async (request, accountId) => {
    const primary = await evaluate(dependencies.primary, checks(request, accountId, POLICY));
    let denied = primary.denied;
    if (primary.failures > 0) {
      try {
        dependencies.onStoreError();
      } catch {
        // Diagnostics cannot disable the in-process fallback.
      }
      if (denied.length === 0) {
        denied = (
          await evaluate(dependencies.fallback, checks(request, accountId, FALLBACK_POLICY))
        ).denied;
      }
    }
    if (denied.length === 0) return { allowed: true, retryAfterSeconds: 0 };
    try {
      dependencies.incrementRateLimitHit();
    } catch {
      // Diagnostics cannot replace the required denial response.
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(...denied.map((result) => result.retryAfterSeconds)),
    };
  };
}
