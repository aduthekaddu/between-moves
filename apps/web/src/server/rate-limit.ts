import { UpstashRateLimiter } from '@between-moves/adapters';
import type { RateLimitResult } from '@between-moves/domain';
import { createInvitationMetricStubs } from '@between-moves/observability';
import { createMoveMetricStubs } from '@between-moves/observability';
import { createNoteMetricStubs } from '@between-moves/observability';
import { createReactionMetricStubs } from '@between-moves/observability';
import { createRealtimeMetricStubs } from '@between-moves/observability';
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
import { createNoteRateLimit, type NoteRateLimit } from '../kernel/note-rate-limit';
import { createReactionRateLimit, type ReactionRateLimit } from '../kernel/reaction-rate-limit';
import {
  createRealtimeTokenRateLimit,
  type RealtimeTokenRateLimit,
} from '../kernel/realtime-token-rate-limit';
import { getIdentityMetrics } from './identity-metrics';
import { getLogger } from './logger';

const globalRateLimit = globalThis as typeof globalThis & {
  betweenMovesSignInRateLimit?: (request: Request, email: string) => Promise<RateLimitResult>;
  betweenMovesRecoveryRateLimit?: (request: Request, email: string) => Promise<RateLimitResult>;
  betweenMovesInvitationRateLimit?: InvitationRateLimit;
  betweenMovesMoveRateLimit?: MoveRateLimit;
  betweenMovesMoveMetrics?: ReturnType<typeof createMoveMetricStubs>;
  betweenMovesNoteRateLimit?: NoteRateLimit;
  betweenMovesNoteMetrics?: ReturnType<typeof createNoteMetricStubs>;
  betweenMovesReactionRateLimit?: ReactionRateLimit;
  betweenMovesReactionMetrics?: ReturnType<typeof createReactionMetricStubs>;
  betweenMovesRealtimeTokenRateLimit?: RealtimeTokenRateLimit;
  betweenMovesRealtimeMetrics?: ReturnType<typeof createRealtimeMetricStubs>;
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

export function getNoteMetrics(): ReturnType<typeof createNoteMetricStubs> {
  globalRateLimit.betweenMovesNoteMetrics ??= createNoteMetricStubs();
  return globalRateLimit.betweenMovesNoteMetrics;
}

/** [BM-032] Composition root for fail-open per-account and per-IP Game-note limits. */
export function getNoteRateLimit(): NoteRateLimit {
  if (!globalRateLimit.betweenMovesNoteRateLimit) {
    const config = getConfig();
    globalRateLimit.betweenMovesNoteRateLimit = createNoteRateLimit({
      primary: new UpstashRateLimiter({
        url: config.upstashRedisRestUrl.href,
        token: config.upstashRedisRestToken,
      }),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: () => getNoteMetrics().incrementRateLimitHit(),
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
          data: { surface: 'game-note', fallback: 'in-process' },
        });
      },
    });
  }
  return globalRateLimit.betweenMovesNoteRateLimit;
}

/** [BM-037] Process-local realtime_token_issue_total and rate-limit counters. */
export function getRealtimeMetrics(): ReturnType<typeof createRealtimeMetricStubs> {
  globalRateLimit.betweenMovesRealtimeMetrics ??= createRealtimeMetricStubs();
  return globalRateLimit.betweenMovesRealtimeMetrics;
}

/** [BM-037] Composition root for fail-open per-account and per-IP realtime token limits. */
export function getRealtimeTokenRateLimit(): RealtimeTokenRateLimit {
  if (!globalRateLimit.betweenMovesRealtimeTokenRateLimit) {
    const config = getConfig();
    globalRateLimit.betweenMovesRealtimeTokenRateLimit = createRealtimeTokenRateLimit({
      primary: new UpstashRateLimiter({
        url: config.upstashRedisRestUrl.href,
        token: config.upstashRedisRestToken,
      }),
      fallback: new InMemoryRateLimiter(),
      incrementRateLimitHit: () => getRealtimeMetrics().incrementRateLimitHit(),
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
          data: { surface: 'realtime-token', fallback: 'in-process' },
        });
      },
    });
  }
  return globalRateLimit.betweenMovesRealtimeTokenRateLimit;
}
