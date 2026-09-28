import { UpstashRateLimiter } from '@between-moves/adapters';
import type { RateLimitResult, RateLimiter } from '@between-moves/domain';
import {
  createChatMetricStubs,
  createInvitationMetricStubs,
  createMoveMetricStubs,
  createNoteMetricStubs,
  createReactionMetricStubs,
  createRealtimeMetricStubs,
  createRateLimitMetricStubs,
  type SecurityRateLimitSurface,
} from '@between-moves/observability';
import { getConfig, type AppConfig } from '../config';
import {
  createRecoveryRateLimit,
  createSignInRateLimit,
  InMemoryRateLimiter,
  type AccountRateLimit,
  type AccountRateLimitDependencies,
  type AuthRateLimitDependencies,
} from '../kernel/rate-limit';
import {
  createInvitationRateLimit,
  type InvitationRateLimit,
} from '../kernel/invitation-rate-limit';
import { createMoveRateLimit, type MoveRateLimit } from '../kernel/move-rate-limit';
import { createChatRateLimit, type ChatRateLimit } from '../kernel/chat-rate-limit';
import { createNoteRateLimit, type NoteRateLimit } from '../kernel/note-rate-limit';
import { createReactionRateLimit, type ReactionRateLimit } from '../kernel/reaction-rate-limit';
import {
  createRealtimeTokenRateLimit,
  type RealtimeTokenRateLimit,
} from '../kernel/realtime-token-rate-limit';
import { createPresenceRateLimit, type PresenceRateLimit } from '../kernel/presence-rate-limit';
import { getIdentityMetrics } from './identity-metrics';
import { getLogger } from './logger';

// [BM-051:AC-2] Shared composition roots for all account and invitation HTTP limits.

type EmailRateLimit = (request: Request, email: string) => Promise<RateLimitResult>;

const globalRateLimit = globalThis as typeof globalThis & {
  betweenMovesSignInRateLimit?: EmailRateLimit;
  betweenMovesRecoveryRateLimit?: EmailRateLimit;
  betweenMovesInvitationRateLimit?: InvitationRateLimit;
  betweenMovesMoveRateLimit?: MoveRateLimit;
  betweenMovesMoveMetrics?: ReturnType<typeof createMoveMetricStubs>;
  betweenMovesNoteRateLimit?: NoteRateLimit;
  betweenMovesNoteMetrics?: ReturnType<typeof createNoteMetricStubs>;
  betweenMovesChatRateLimit?: ChatRateLimit;
  betweenMovesChatMetrics?: ReturnType<typeof createChatMetricStubs>;
  betweenMovesReactionRateLimit?: ReactionRateLimit;
  betweenMovesReactionMetrics?: ReturnType<typeof createReactionMetricStubs>;
  betweenMovesRealtimeTokenRateLimit?: RealtimeTokenRateLimit;
  betweenMovesPresenceRateLimit?: PresenceRateLimit;
  betweenMovesRealtimeMetrics?: ReturnType<typeof createRealtimeMetricStubs>;
  betweenMovesRateLimitMetrics?: ReturnType<typeof createRateLimitMetricStubs>;
};

const invitationMetrics = createInvitationMetricStubs();

export function getRateLimitMetrics(): ReturnType<typeof createRateLimitMetricStubs> {
  globalRateLimit.betweenMovesRateLimitMetrics ??= createRateLimitMetricStubs();
  return globalRateLimit.betweenMovesRateLimitMetrics;
}

function recordRateLimitHit(surface: SecurityRateLimitSurface, legacy: () => void): void {
  try {
    legacy();
  } catch {
    // A metric failure must never replace a rate-limit denial.
  }
  try {
    getRateLimitMetrics().incrementRateLimitHit(surface);
  } catch {
    // Keep the denial even if the aggregate metric is unavailable.
  }
}

export function createSharedRateLimiter(
  config: Pick<AppConfig, 'environment' | 'upstashRedisRestUrl' | 'upstashRedisRestToken'>,
): RateLimiter {
  if (config.environment === 'local') return new InMemoryRateLimiter();
  return new UpstashRateLimiter({
    url: config.upstashRedisRestUrl.href,
    token: config.upstashRedisRestToken,
  });
}

function logStoreUnavailable(surface: string, fallback: 'in-process' | 'fail-open'): void {
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
    data: { surface, fallback },
  });
}

function authRateLimitDependencies(): AuthRateLimitDependencies {
  return {
    primary: createSharedRateLimiter(getConfig()),
    fallback: new InMemoryRateLimiter(),
    metrics: {
      incrementRateLimitHit: (surface) =>
        recordRateLimitHit(surface, () => getIdentityMetrics().incrementRateLimitHit(surface)),
    },
    onStoreError: (surface) => logStoreUnavailable(surface, 'in-process'),
  };
}

function accountRateLimit(
  create: (dependencies: AccountRateLimitDependencies) => AccountRateLimit,
  surface: SecurityRateLimitSurface,
  incrementRateLimitHit: () => void,
): AccountRateLimit {
  return create({
    primary: createSharedRateLimiter(getConfig()),
    fallback: new InMemoryRateLimiter(),
    incrementRateLimitHit: () => recordRateLimitHit(surface, incrementRateLimitHit),
    onStoreError: () => logStoreUnavailable(surface, 'in-process'),
  });
}

/** [BM-009] Composition root for the reusable auth-surface limiter. */
export function getSignInRateLimit(): EmailRateLimit {
  globalRateLimit.betweenMovesSignInRateLimit ??= createSignInRateLimit(
    authRateLimitDependencies(),
  );
  return globalRateLimit.betweenMovesSignInRateLimit;
}

/** [BM-010] Composition root for independently keyed account-recovery limits. */
export function getRecoveryRateLimit(): EmailRateLimit {
  globalRateLimit.betweenMovesRecoveryRateLimit ??= createRecoveryRateLimit(
    authRateLimitDependencies(),
  );
  return globalRateLimit.betweenMovesRecoveryRateLimit;
}

/** [BM-014] Composition root for fail-open Invitation create and inspect limits. */
export function getInvitationRateLimit(): InvitationRateLimit {
  globalRateLimit.betweenMovesInvitationRateLimit ??= createInvitationRateLimit({
    primary: createSharedRateLimiter(getConfig()),
    incrementRateLimitHit: (surface) =>
      recordRateLimitHit(`invitation-${surface}`, () =>
        invitationMetrics.incrementRateLimitHit(surface),
      ),
    onStoreError: (surface) => logStoreUnavailable(`invitation-${surface}`, 'fail-open'),
  });
  return globalRateLimit.betweenMovesInvitationRateLimit;
}

export function getMoveMetrics(): ReturnType<typeof createMoveMetricStubs> {
  globalRateLimit.betweenMovesMoveMetrics ??= createMoveMetricStubs();
  return globalRateLimit.betweenMovesMoveMetrics;
}

/** [BM-024] Composition root for fail-open per-account and per-IP Move limits. */
export function getMoveRateLimit(): MoveRateLimit {
  globalRateLimit.betweenMovesMoveRateLimit ??= accountRateLimit(createMoveRateLimit, 'move', () =>
    getMoveMetrics().incrementRateLimitHit(),
  );
  return globalRateLimit.betweenMovesMoveRateLimit;
}

export function getReactionMetrics(): ReturnType<typeof createReactionMetricStubs> {
  globalRateLimit.betweenMovesReactionMetrics ??= createReactionMetricStubs();
  return globalRateLimit.betweenMovesReactionMetrics;
}

/** [BM-031] Composition root for fail-open per-account and per-IP Reaction limits. */
export function getReactionRateLimit(): ReactionRateLimit {
  globalRateLimit.betweenMovesReactionRateLimit ??= accountRateLimit(
    createReactionRateLimit,
    'reaction',
    () => getReactionMetrics().incrementRateLimitHit(),
  );
  return globalRateLimit.betweenMovesReactionRateLimit;
}

export function getNoteMetrics(): ReturnType<typeof createNoteMetricStubs> {
  globalRateLimit.betweenMovesNoteMetrics ??= createNoteMetricStubs();
  return globalRateLimit.betweenMovesNoteMetrics;
}

/** [BM-032] Composition root for fail-open per-account and per-IP Game-note limits. */
export function getNoteRateLimit(): NoteRateLimit {
  globalRateLimit.betweenMovesNoteRateLimit ??= accountRateLimit(
    createNoteRateLimit,
    'game-note',
    () => getNoteMetrics().incrementRateLimitHit(),
  );
  return globalRateLimit.betweenMovesNoteRateLimit;
}

export function getChatMetrics(): ReturnType<typeof createChatMetricStubs> {
  globalRateLimit.betweenMovesChatMetrics ??= createChatMetricStubs();
  return globalRateLimit.betweenMovesChatMetrics;
}

/** [BM-040] Composition root for fail-open per-account and per-IP House-chat limits. */
export function getChatRateLimit(): ChatRateLimit {
  globalRateLimit.betweenMovesChatRateLimit ??= accountRateLimit(
    createChatRateLimit,
    'house-chat',
    () => getChatMetrics().incrementRateLimitHit(),
  );
  return globalRateLimit.betweenMovesChatRateLimit;
}

/** [BM-037] Process-local realtime_token_issue_total and rate-limit counters. */
export function getRealtimeMetrics(): ReturnType<typeof createRealtimeMetricStubs> {
  globalRateLimit.betweenMovesRealtimeMetrics ??= createRealtimeMetricStubs();
  return globalRateLimit.betweenMovesRealtimeMetrics;
}

/** [BM-037] Composition root for fail-open per-account and per-IP realtime token limits. */
export function getRealtimeTokenRateLimit(): RealtimeTokenRateLimit {
  globalRateLimit.betweenMovesRealtimeTokenRateLimit ??= accountRateLimit(
    createRealtimeTokenRateLimit,
    'realtime-token',
    () => getRealtimeMetrics().incrementRateLimitHit(),
  );
  return globalRateLimit.betweenMovesRealtimeTokenRateLimit;
}

/** [BM-039] Composition root for fail-open per-account and per-IP presence limits. */
export function getPresenceRateLimit(): PresenceRateLimit {
  globalRateLimit.betweenMovesPresenceRateLimit ??= accountRateLimit(
    createPresenceRateLimit,
    'presence',
    () => getRealtimeMetrics().incrementRateLimitHit(),
  );
  return globalRateLimit.betweenMovesPresenceRateLimit;
}
