import type { RateLimitPolicy, RateLimiter, RateLimitResult } from '@between-moves/domain';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

interface UpstashLimitClient {
  limit(identifier: string): Promise<{ readonly success: boolean; readonly reset: number }>;
}

export type UpstashLimitClientFactory = (policy: RateLimitPolicy) => UpstashLimitClient;

interface SharedOptions {
  readonly now?: () => number;
}

export type UpstashRateLimiterOptions = SharedOptions &
  (
    | {
        readonly url: string;
        readonly token: string;
        readonly prefix?: string;
      }
    | {
        readonly clientFactory: UpstashLimitClientFactory;
      }
  );

function providerFactory(url: string, token: string, prefix: string): UpstashLimitClientFactory {
  const redis = new Redis({ url, token });
  return (policy) =>
    new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(policy.limit, `${policy.windowSeconds} s` satisfies Duration),
      prefix,
    });
}

/** [BM-009] [DR-SEC-04] Upstash implementation for serverless shared counters. */
export class UpstashRateLimiter implements RateLimiter {
  private readonly clients = new Map<string, UpstashLimitClient>();
  private readonly clientFactory: UpstashLimitClientFactory;
  private readonly now: () => number;

  constructor(options: UpstashRateLimiterOptions) {
    this.clientFactory =
      'clientFactory' in options
        ? options.clientFactory
        : providerFactory(options.url, options.token, options.prefix ?? 'between-moves:rate-limit');
    this.now = options.now ?? Date.now;
  }

  async limit(input: {
    readonly key: string;
    readonly policy: RateLimitPolicy;
  }): Promise<RateLimitResult> {
    const policyKey = `${input.policy.limit}:${input.policy.windowSeconds}`;
    let client = this.clients.get(policyKey);
    if (!client) {
      client = this.clientFactory(input.policy);
      this.clients.set(policyKey, client);
    }

    const result = await client.limit(input.key);
    if (result.success) return { allowed: true, retryAfterSeconds: 0 };

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((result.reset - this.now()) / 1_000)),
    };
  }
}
