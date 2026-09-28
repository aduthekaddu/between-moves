import { UpstashRateLimiter } from '@between-moves/adapters';
import type { RateLimitInput, RateLimitResult } from '@between-moves/domain';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { AppEnvironment } from '../config';
import { InMemoryRateLimiter } from '../kernel/rate-limit';
import { getIdentityMetrics } from './identity-metrics';
import type { SecurityRateLimitSurface } from '@between-moves/observability';
import {
  createSharedRateLimiter,
  getChatMetrics,
  getChatRateLimit,
  getInvitationRateLimit,
  getMoveMetrics,
  getMoveRateLimit,
  getNoteMetrics,
  getNoteRateLimit,
  getPresenceRateLimit,
  getRateLimitMetrics,
  getReactionMetrics,
  getReactionRateLimit,
  getRealtimeMetrics,
  getRealtimeTokenRateLimit,
  getRecoveryRateLimit,
  getSignInRateLimit,
} from './rate-limit';

const store = vi.hoisted(() => ({
  constructed: 0,
  limit: vi.fn<(input: RateLimitInput) => Promise<RateLimitResult>>(),
}));
const environment = vi.hoisted(() => ({ current: 'local' as AppEnvironment }));
const log = vi.hoisted(() => vi.fn());

vi.mock('@between-moves/adapters', () => ({
  UpstashRateLimiter: class {
    constructor() {
      store.constructed += 1;
    }

    limit(input: RateLimitInput): Promise<RateLimitResult> {
      return store.limit(input);
    }
  },
}));
vi.mock('../config', () => ({
  getConfig: () => ({
    environment: environment.current,
    upstashRedisRestUrl: new URL('https://rate-limit.example.test'),
    upstashRedisRestToken: 'upstash-test-token',
  }),
}));
vi.mock('./logger', () => ({ getLogger: () => ({ log }) }));

const config = {
  environment: 'local' as const,
  upstashRedisRestUrl: new URL('https://rate-limit.example.test'),
  upstashRedisRestToken: 'upstash-test-token',
};

const request = new Request('https://app.example.test/api/example', {
  headers: { 'x-forwarded-for': '203.0.113.9' },
});

interface Surface {
  readonly name: string;
  readonly surface: string;
  readonly fallback: 'in-process' | 'fail-open';
  readonly limiter: () => unknown;
  readonly check: () => Promise<RateLimitResult>;
  /** Invitation hits land in module-private stubs, so that row checks only the decision. */
  readonly hits: (() => MockInstance) | null;
  readonly hitArguments: readonly unknown[];
}

const surfaces: readonly Surface[] = [
  {
    name: 'sign-in',
    surface: 'signin',
    fallback: 'in-process',
    limiter: getSignInRateLimit,
    check: () => getSignInRateLimit()(request, 'member@example.test'),
    hits: () => vi.spyOn(getIdentityMetrics(), 'incrementRateLimitHit'),
    hitArguments: ['signin'],
  },
  {
    name: 'recovery',
    surface: 'recovery',
    fallback: 'in-process',
    limiter: getRecoveryRateLimit,
    check: () => getRecoveryRateLimit()(request, 'member@example.test'),
    hits: () => vi.spyOn(getIdentityMetrics(), 'incrementRateLimitHit'),
    hitArguments: ['recovery'],
  },
  {
    name: 'invitation',
    surface: 'invitation-create',
    fallback: 'fail-open',
    limiter: getInvitationRateLimit,
    check: () => getInvitationRateLimit()(request, 'actor-id', 'create'),
    hits: null,
    hitArguments: [],
  },
  {
    name: 'move',
    surface: 'move',
    fallback: 'in-process',
    limiter: getMoveRateLimit,
    check: () => getMoveRateLimit()(request, 'actor-id'),
    hits: () => vi.spyOn(getMoveMetrics(), 'incrementRateLimitHit'),
    hitArguments: [],
  },
  {
    name: 'reaction',
    surface: 'reaction',
    fallback: 'in-process',
    limiter: getReactionRateLimit,
    check: () => getReactionRateLimit()(request, 'actor-id'),
    hits: () => vi.spyOn(getReactionMetrics(), 'incrementRateLimitHit'),
    hitArguments: [],
  },
  {
    name: 'Game note',
    surface: 'game-note',
    fallback: 'in-process',
    limiter: getNoteRateLimit,
    check: () => getNoteRateLimit()(request, 'actor-id'),
    hits: () => vi.spyOn(getNoteMetrics(), 'incrementRateLimitHit'),
    hitArguments: [],
  },
  {
    name: 'House chat',
    surface: 'house-chat',
    fallback: 'in-process',
    limiter: getChatRateLimit,
    check: () => getChatRateLimit()(request, 'actor-id'),
    hits: () => vi.spyOn(getChatMetrics(), 'incrementRateLimitHit'),
    hitArguments: [],
  },
  {
    name: 'realtime token',
    surface: 'realtime-token',
    fallback: 'in-process',
    limiter: getRealtimeTokenRateLimit,
    check: () => getRealtimeTokenRateLimit()(request, 'actor-id'),
    hits: () => vi.spyOn(getRealtimeMetrics(), 'incrementRateLimitHit'),
    hitArguments: [],
  },
  {
    name: 'presence',
    surface: 'presence',
    fallback: 'in-process',
    limiter: getPresenceRateLimit,
    check: () => getPresenceRateLimit()(request, 'actor-id'),
    hits: () => vi.spyOn(getRealtimeMetrics(), 'incrementRateLimitHit'),
    hitArguments: [],
  },
];

beforeEach(() => {
  // Composition roots cache on globalThis to survive dev reloads; start each test cold.
  for (const key of Object.keys(globalThis)) {
    if (key.startsWith('betweenMoves')) Reflect.deleteProperty(globalThis, key);
  }
  environment.current = 'local';
  store.constructed = 0;
  store.limit.mockReset();
  log.mockReset();
});

describe('shared rate-limit provider', () => {
  it('[BM-039] keeps local E2E rate limits in process', () => {
    expect(createSharedRateLimiter(config)).toBeInstanceOf(InMemoryRateLimiter);
  });

  it('[BM-039] uses Upstash outside local environments', () => {
    expect(createSharedRateLimiter({ ...config, environment: 'preview' })).toBeInstanceOf(
      UpstashRateLimiter,
    );
  });
});

describe('rate-limit composition roots', () => {
  it('[BM-051:AC-2] records invitation inspect and redeem denials under distinct surface labels', async () => {
    environment.current = 'preview';
    store.limit.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 });
    for (const surface of ['inspect', 'redeem'] as const) {
      const label = `invitation-${surface}` as const;
      const before = getRateLimitMetrics().snapshot().rate_limit_hit_total[label];
      await expect(getInvitationRateLimit()(request, 'actor-id', surface)).resolves.toEqual({
        allowed: false,
        retryAfterSeconds: 7,
      });
      expect(getRateLimitMetrics().snapshot().rate_limit_hit_total[label]).toBe(before + 1);
    }
  });

  it.each(surfaces)(
    '[DR-SEC-04] keeps the $name limiter in process locally and reuses it',
    async ({ limiter, check }) => {
      await expect(check()).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
      expect(limiter()).toBe(limiter());
      expect(store.constructed).toBe(0);
    },
  );

  it.each(surfaces)(
    '[DR-SEC-04] logs a $name store outage with its surface and fallback',
    async ({ check, surface, fallback }) => {
      environment.current = 'preview';
      store.limit.mockRejectedValue(new Error('store unavailable'));

      await expect(check()).resolves.toMatchObject({ allowed: true });
      expect(store.constructed).toBe(1);
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          event: 'rate-limit.store-unavailable',
          data: { surface, fallback },
        }),
      );
    },
  );

  it.each(surfaces)(
    '[DR-SEC-04] records a $name denial from the shared store',
    async ({ check, hits, hitArguments, surface }) => {
      environment.current = 'preview';
      store.limit.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 });
      const recorded = hits?.();
      const label = surface as SecurityRateLimitSurface;
      const before = getRateLimitMetrics().snapshot().rate_limit_hit_total[label];

      await expect(check()).resolves.toEqual({ allowed: false, retryAfterSeconds: 7 });
      if (recorded) expect(recorded).toHaveBeenCalledExactlyOnceWith(...hitArguments);
      expect(getRateLimitMetrics().snapshot().rate_limit_hit_total[label]).toBe(before + 1);
      expect(log).not.toHaveBeenCalled();
    },
  );
});
