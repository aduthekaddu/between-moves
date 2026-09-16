import { UpstashRateLimiter } from '@between-moves/adapters';
import type { RateLimitResult } from '@between-moves/domain';
import { createInvitationMetricStubs } from '@between-moves/observability';
import { createMoveMetricStubs } from '@between-moves/observability';
import { createReactionMetricStubs } from '@between-moves/observability';
import { getConfig } from '../config';
import {
  createRecoveryRateLimit,
  createSignInRateLimit,
  InMemoryRateLimiter,
} from '../kernel/rate-limit';
import {
  createInvitationRateLimit,
  type InvitationRateLimit,
} from '../kernel/invitation-rate-limit';
import { createMoveRateLimit, type MoveRateLimit } from '../kernel/move-rate-limit';
import { createReactionRateLimit, type ReactionRateLimit } from '../kernel/reaction-rate-limit';
import { getIdentityMetrics } from './identity-metrics';
import { getLogger } from './logger';

const globalRateLimit = globalThis as typeof globalThis & {
  betweenMovesSignInRateLimit?: (request: Request, email: string) => Promise<RateLimitResult>;
  betweenMovesRecoveryRateLimit?: (request: Request, email: string) => Promise<RateLimitResult>;
  betweenMovesInvitationRateLimit?: InvitationRateLimit;
  betweenMovesMoveRateLimit?: MoveRateLimit;
  betweenMovesMoveMetrics?: ReturnType<typeof createMoveMetricStubs>;
  betweenMovesReactionRateLimit?: ReactionRateLimit;
  betweenMovesReactionMetrics?: ReturnType<typeof createReactionMetricStubs>;
};

const invitationMetrics = createInvitationMetricStubs();

/** [BM-009] Composition root for the reusable auth-surface limiter. */
export function getSignInRateLimit(): (
  request: Request,
  email: string,
) => Promise<RateLimitResult> {
  if (!globalRateLimit.betweenMovesSignInRateLimit) {
    const config = getConfig();
    globalRateLimit.betweenMovesSignInRateLimit = createSignInRateLimit({
      primary: new UpstashRateLimiter({
        url: config.upstashRedisRestUrl.href,
        token: config.upstashRedisRestToken,
      }),
      fallback: new InMemoryRateLimiter(),
      metrics: getIdentityMetrics(),
      onStoreError(surface) {
        getLogger().log({
          level: 'warn',
          requestId: 'rate-limit-store',
          actorId: 'anonymous',
          houseId: null,
          gameId: null,
          commandId: null,
          event: 'rate-limit.store-unavailable',
          outcome: 'error',
          durationMs: 0,
          data: { surface, fallback: 'in-process' },
        });
      },
    });
  }
  return globalRateLimit.betweenMovesSignInRateLimit;
}

/** [BM-010] Composition root for independently keyed account-recovery limits. */
export function getRecoveryRateLimit(): (
  request: Request,
  email: string,
) => Promise<RateLimitResult> {
  if (!globalRateLimit.betweenMovesRecoveryRateLimit) {
    const config = getConfig();
    globalRateLimit.betweenMovesRecoveryRateLimit = createRecoveryRateLimit({
      primary: new UpstashRateLimiter({
        url: config.upstashRedisRestUrl.href,
        token: config.upstashRedisRestToken,
      }),
      fallback: new InMemoryRateLimiter(),
      metrics: getIdentityMetrics(),
      onStoreError(surface) {
        getLogger().log({
          level: 'warn',
          requestId: 'rate-limit-store',
          actorId: 'anonymous',
          houseId: null,
          gameId: null,
          commandId: null,
          event: 'rate-limit.store-unavailable',
          outcome: 'error',
          durationMs: 0,
          data: { surface, fallback: 'in-process' },
        });
      },
    });
  }
  return globalRateLimit.betweenMovesRecoveryRateLimit;
}

/** [BM-014] Composition root for fail-open Invitation create and inspect limits. */
export function getInvitationRateLimit(): InvitationRateLimit {
  if (!globalRateLimit.betweenMovesInvitationRateLimit) {
    const config = getConfig();
    globalRateLimit.betweenMovesInvitationRateLimit = createInvitationRateLimit({
      primary: new UpstashRateLimiter({
        url: config.upstashRedisRestUrl.href,
        token: config.upstashRedisRestToken,
      }),
      incrementRateLimitHit: (surface) => invitationMetrics.incrementRateLimitHit(surface),
      onStoreError(surface) {
        getLogger().log({
          level: 'warn',
          requestId: 'rate-limit-store',
          actorId: 'anonymous',
          houseId: null,
          gameId: null,
          commandId: null,
          event: 'rate-limit.store-unavailable',
          outcome: 'error',
          durationMs: 0,
          data: { surface: `invitation-${surface}`, fallback: 'fail-open' },
        });
      },
    });
  }
  return globalRateLimit.betweenMovesInvitationRateLimit;
}

export function getMoveMetrics(): ReturnType<typeof createMoveMetricStubs> {
  globalRateLimit.betweenMovesMoveMetrics ??= createMoveMetricStubs();
  return globalRateLimit.betweenMovesMoveMetrics;
}

/** [BM-024] Composition root for fail-open per-account and per-IP Move limits. */
export function getMoveRateLimit(): MoveRateLimit {
  if (!globalRateLimit.betweenMovesMoveRateLimit) {
    const config = getConfig();
    globalRateLimit.betweenMovesMoveRateLimit = createMoveRateLimit({
      primary: new UpstashRateLimiter({
        url: config.upstashRedisRestUrl.href,
        token: config.upstashRedisRestToken,
      }),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: () => getMoveMetrics().incrementRateLimitHit(),
      onStoreError() {
        getLogger().log({
          level: 'warn',
          requestId: 'rate-limit-store',
          actorId: 'anonymous',
          houseId: null,
          gameId: null,
          commandId: null,
          event: 'rate-limit.store-unavailable',
          outcome: 'error',
          durationMs: 0,
          data: { surface: 'move', fallback: 'in-process' },
        });
      },
    });
  }
  return globalRateLimit.betweenMovesMoveRateLimit;
}

export function getReactionMetrics(): ReturnType<typeof createReactionMetricStubs> {
  globalRateLimit.betweenMovesReactionMetrics ??= createReactionMetricStubs();
  return globalRateLimit.betweenMovesReactionMetrics;
}

/** [BM-031] Composition root for fail-open per-account and per-IP Reaction limits. */
export function getReactionRateLimit(): ReactionRateLimit {
  if (!globalRateLimit.betweenMovesReactionRateLimit) {
    const config = getConfig();
    globalRateLimit.betweenMovesReactionRateLimit = createReactionRateLimit({
      primary: new UpstashRateLimiter({
        url: config.upstashRedisRestUrl.href,
        token: config.upstashRedisRestToken,
      }),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: () => getReactionMetrics().incrementRateLimitHit(),
      onStoreError() {
        getLogger().log({
          level: 'warn',
          requestId: 'rate-limit-store',
          actorId: 'anonymous',
          houseId: null,
          gameId: null,
          commandId: null,
          event: 'rate-limit.store-unavailable',
          outcome: 'error',
          durationMs: 0,
          data: { surface: 'reaction', fallback: 'in-process' },
        });
      },
    });
  }
  return globalRateLimit.betweenMovesReactionRateLimit;
}
