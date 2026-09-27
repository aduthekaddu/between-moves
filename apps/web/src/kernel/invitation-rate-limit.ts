import type { RateLimitInput, RateLimiter, RateLimitResult } from '@between-moves/domain';
import { clientIp, digest } from './rate-limit';

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * 60;

export type InvitationRateLimitSurface = 'create' | 'inspect' | 'redeem';

const POLICIES = {
  create: {
    account: { limit: 20, windowSeconds: HOUR_SECONDS },
    ip: { limit: 40, windowSeconds: HOUR_SECONDS },
  },
  inspect: {
    account: { limit: 30, windowSeconds: MINUTE_SECONDS },
    ip: { limit: 60, windowSeconds: MINUTE_SECONDS },
  },
  redeem: {
    account: { limit: 10, windowSeconds: HOUR_SECONDS },
    ip: { limit: 30, windowSeconds: HOUR_SECONDS },
  },
} as const;

export interface InvitationRateLimitDependencies {
  readonly primary: RateLimiter;
  readonly incrementRateLimitHit: (surface: InvitationRateLimitSurface) => void;
  readonly onStoreError: (surface: InvitationRateLimitSurface) => void;
}

export type InvitationRateLimit = (
  request: Request,
  accountId: string,
  surface: InvitationRateLimitSurface,
) => Promise<RateLimitResult>;

function checks(
  request: Request,
  accountId: string,
  surface: InvitationRateLimitSurface,
): readonly RateLimitInput[] {
  return [
    {
      key: `invitation:${surface}:account:${digest(accountId)}`,
      policy: POLICIES[surface].account,
    },
    { key: `invitation:${surface}:ip:${digest(clientIp(request))}`, policy: POLICIES[surface].ip },
  ];
}

/** [BM-014/016] [DR-INVITE-13] Defensive per-account and per-IP Invitation limiter. */
export function createInvitationRateLimit(
  dependencies: InvitationRateLimitDependencies,
): InvitationRateLimit {
  return async (request, accountId, surface) => {
    const settled = await Promise.allSettled(
      checks(request, accountId, surface).map((input) => dependencies.primary.limit(input)),
    );
    if (settled.some((result) => result.status === 'rejected')) {
      dependencies.onStoreError(surface);
    }
    const denied = settled.flatMap((result) =>
      result.status === 'fulfilled' && !result.value.allowed ? [result.value] : [],
    );
    if (denied.length === 0) return { allowed: true, retryAfterSeconds: 0 };

    dependencies.incrementRateLimitHit(surface);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(...denied.map((result) => result.retryAfterSeconds)),
    };
  };
}
