import type {
  RateLimitInput,
  RateLimitPolicy,
  RateLimiter,
  RateLimitResult,
} from '@between-moves/domain';
import { createHash } from 'node:crypto';

const HOUR_SECONDS = 60 * 60;
const SIGN_IN_POLICIES = {
  account: { limit: 5, windowSeconds: HOUR_SECONDS },
  ip: { limit: 20, windowSeconds: HOUR_SECONDS },
} as const satisfies Record<string, RateLimitPolicy>;
const SIGN_IN_FALLBACK_POLICIES = {
  account: { limit: 3, windowSeconds: HOUR_SECONDS },
  ip: { limit: 10, windowSeconds: HOUR_SECONDS },
} as const satisfies Record<string, RateLimitPolicy>;

interface Bucket {
  count: number;
  readonly limit: number;
  readonly resetAt: number;
  readonly windowSeconds: number;
}

export interface InMemoryRateLimiterOptions {
  readonly now?: () => number;
}

/** Process-local fixed-window fallback. Shared stores remain the primary authority. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(options: InMemoryRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async limit(input: RateLimitInput): Promise<RateLimitResult> {
    const now = this.now();
    let bucket = this.buckets.get(input.key);
    const policyChanged =
      bucket?.limit !== input.policy.limit || bucket.windowSeconds !== input.policy.windowSeconds;

    if (!bucket || bucket.resetAt <= now || policyChanged) {
      bucket = {
        count: 0,
        limit: input.policy.limit,
        resetAt: now + input.policy.windowSeconds * 1_000,
        windowSeconds: input.policy.windowSeconds,
      };
      this.buckets.set(input.key, bucket);
    }

    bucket.count += 1;
    if (bucket.count <= input.policy.limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }
}

type AuthRateLimitSurface = 'signin' | 'recovery';

interface RateLimitMetrics {
  incrementRateLimitHit(surface: AuthRateLimitSurface): void;
}

export interface AuthRateLimitDependencies {
  readonly primary: RateLimiter;
  readonly fallback: RateLimiter;
  readonly metrics: RateLimitMetrics;
  readonly onStoreError: (surface: AuthRateLimitSurface) => void;
}

export type SignInRateLimitDependencies = AuthRateLimitDependencies;

interface RateLimitChecks {
  readonly primary: readonly RateLimitInput[];
  readonly fallback: readonly RateLimitInput[];
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function authChecks(
  surface: AuthRateLimitSurface,
  request: Request,
  email: string,
): RateLimitChecks {
  const accountKey = `${surface}:account:${digest(email.trim().toLowerCase())}`;
  const ipKey = `${surface}:ip:${digest(clientIp(request))}`;
  return {
    primary: [
      { key: accountKey, policy: SIGN_IN_POLICIES.account },
      { key: ipKey, policy: SIGN_IN_POLICIES.ip },
    ],
    fallback: [
      { key: accountKey, policy: SIGN_IN_FALLBACK_POLICIES.account },
      { key: ipKey, policy: SIGN_IN_FALLBACK_POLICIES.ip },
    ],
  };
}

async function evaluate(
  limiter: RateLimiter,
  checks: readonly RateLimitInput[],
): Promise<{
  readonly failures: number;
  readonly denied: readonly RateLimitResult[];
}> {
  const results = await Promise.allSettled(checks.map((check) => limiter.limit(check)));
  return {
    failures: results.filter((result) => result.status === 'rejected').length,
    denied: results.flatMap((result) =>
      result.status === 'fulfilled' && !result.value.allowed ? [result.value] : [],
    ),
  };
}

function decision(denied: readonly RateLimitResult[]): RateLimitResult {
  if (denied.length === 0) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(...denied.map((result) => result.retryAfterSeconds)),
  };
}

/** [BM-009] [BM-010] [DR-SEC-04] Reusable dual-scope guard for auth request seams. */
function createAuthRateLimit(
  surface: AuthRateLimitSurface,
  dependencies: AuthRateLimitDependencies,
): (request: Request, email: string) => Promise<RateLimitResult> {
  return async (request, email) => {
    const checks = authChecks(surface, request, email);
    const primary = await evaluate(dependencies.primary, checks.primary);
    let result = decision(primary.denied);

    if (primary.failures > 0) {
      dependencies.onStoreError(surface);
      if (result.allowed) {
        const fallback = await evaluate(dependencies.fallback, checks.fallback);
        result = fallback.failures > 0 ? result : decision(fallback.denied);
      }
    }

    if (!result.allowed) dependencies.metrics.incrementRateLimitHit(surface);
    return result;
  };
}

export function createSignInRateLimit(
  dependencies: SignInRateLimitDependencies,
): (request: Request, email: string) => Promise<RateLimitResult> {
  return createAuthRateLimit('signin', dependencies);
}

export function createRecoveryRateLimit(
  dependencies: AuthRateLimitDependencies,
): (request: Request, email: string) => Promise<RateLimitResult> {
  return createAuthRateLimit('recovery', dependencies);
}
