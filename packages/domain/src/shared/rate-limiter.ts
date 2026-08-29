/** [BM-009] [DR-SEC-04] Framework-agnostic defensive rate-limit policy. */
export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitInput {
  readonly key: string;
  readonly policy: RateLimitPolicy;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  limit(input: RateLimitInput): Promise<RateLimitResult>;
}
