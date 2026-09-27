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

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export interface AccountRateLimitPolicy {
  readonly account: RateLimitPolicy;
  readonly ip: RateLimitPolicy;
}

export interface AccountRateLimitOptions {
  /** Store key namespace; changing it resets the surface's existing counters. */
  readonly scope: string;
  readonly policy: AccountRateLimitPolicy;
  readonly fallbackPolicy: AccountRateLimitPolicy;
}

export interface AccountRateLimitDependencies {
  readonly primary: RateLimiter;
  readonly fallback: RateLimiter;
  readonly incrementRateLimitHit: () => void;
  readonly onStoreError: () => void;
}

export type AccountRateLimit = (request: Request, accountId: string) => Promise<RateLimitResult>;

function accountChecks(
  scope: string,
  request: Request,
  accountId: string,
  policy: AccountRateLimitPolicy,
): readonly RateLimitInput[] {
  return [
    { key: `${scope}:account:${digest(accountId)}`, policy: policy.account },
    { key: `${scope}:ip:${digest(clientIp(request))}`, policy: policy.ip },
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

/** [DR-SEC-04] Fail-open per-account and per-IP limiter with a tighter in-process fallback. */
export function createAccountRateLimit(
  options: AccountRateLimitOptions,
  dependencies: AccountRateLimitDependencies,
): AccountRateLimit {
  return async (request, accountId) => {
    const primary = await evaluate(
      dependencies.primary,
      accountChecks(options.scope, request, accountId, options.policy),
    );
    let denied = primary.denied;
    if (primary.failures > 0) {
      try {
        dependencies.onStoreError();
      } catch {
        // Diagnostics cannot disable the in-process fallback.
      }
      if (denied.length === 0) {
        denied = (
          await evaluate(
            dependencies.fallback,
            accountChecks(options.scope, request, accountId, options.fallbackPolicy),
          )
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

/** [BM-009] [BM-010] [DR-SEC-04] Reusable dual-scope guard for auth request seams. */
function createAuthRateLimit(
  surface: AuthRateLimitSurface,
  dependencies: AuthRateLimitDependencies,
): (request: Request, email: string) => Promise<RateLimitResult> {
  const limit = createAccountRateLimit(
    { scope: surface, policy: SIGN_IN_POLICIES, fallbackPolicy: SIGN_IN_FALLBACK_POLICIES },
    {
      primary: dependencies.primary,
      fallback: dependencies.fallback,
      incrementRateLimitHit: () => dependencies.metrics.incrementRateLimitHit(surface),
      onStoreError: () => dependencies.onStoreError(surface),
    },
  );
  return (request, email) => limit(request, email.trim().toLowerCase());
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
