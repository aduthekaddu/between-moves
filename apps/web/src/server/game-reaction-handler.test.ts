import { HouseAuthorizationDeniedError, type RateLimitResult } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from '../kernel/rate-limit';
import { createReactionRateLimit } from '../kernel/reaction-rate-limit';
import { createGameReactionHandler } from './game-reaction-handler';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const gameId = '01941f29-7c00-7000-8000-000000000701';
const viewer = {
  kind: 'authenticated' as const,
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

function request(body: unknown = { reaction: 'brilliant' }) {
  return new Request(`https://betweenmoves.test/api/houses/${houseId}/games/${gameId}/reactions`, {
    method: 'POST',
    headers: {
      origin: 'https://betweenmoves.test',
      'content-type': 'application/json',
      'x-request-id': 'bm-031-reaction',
    },
    body: JSON.stringify(body),
  });
}

function dependencies() {
  return {
    expectedOrigin: 'https://betweenmoves.test',
    requireViewer: vi.fn(async () => viewer),
    limitReaction: vi.fn(async (): Promise<RateLimitResult> => ({
      allowed: true,
      retryAfterSeconds: 0,
    })),
    setGameReaction: vi.fn(async () => ({
      membershipId: '01941f29-7c00-7000-8000-000000000201',
      reaction: 'brilliant' as const,
      reactedAt: new Date('2026-09-16T08:00:00.000Z'),
    })),
    logger: { log: vi.fn() },
    metrics: { incrementReactionSet: vi.fn(), incrementRateLimitHit: vi.fn(), snapshot: vi.fn() },
    clock: { now: () => new Date('2026-09-16T08:00:00.000Z') },
  };
}

describe('POST /api/houses/{houseId}/games/{gameId}/reactions', () => {
  it('[BM-031] sets a Reaction and observes bm.reaction.set', async () => {
    const deps = dependencies();
    const incoming = request();
    const response = await createGameReactionHandler(deps)(incoming, houseId, gameId);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      reaction: 'brilliant',
      reactedAt: '2026-09-16T08:00:00.000Z',
    });
    expect(deps.limitReaction).toHaveBeenCalledWith(incoming, viewer.userId);
    expect(deps.setGameReaction).toHaveBeenCalledWith({
      houseId,
      gameId,
      reaction: 'brilliant',
      viewer,
    });
    expect(deps.metrics.incrementReactionSet).toHaveBeenCalledOnce();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'bm.reaction.set',
        actorId: viewer.userId,
        houseId,
        gameId,
        outcome: 'success',
        data: {
          reaction: 'brilliant',
          actor_membership_id: '01941f29-7c00-7000-8000-000000000201',
        },
      }),
    );
  });

  it('[BM-031] returns 429 before parsing or writing', async () => {
    const deps = dependencies();
    deps.limitReaction.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
    const response = await createGameReactionHandler(deps)(request(), houseId, gameId);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expect(deps.setGameReaction).not.toHaveBeenCalled();
  });

  it('[BM-031] [DR-SEC-04] returns 429 at the real account boundary', async () => {
    const deps = dependencies();
    const handler = createGameReactionHandler({
      ...deps,
      limitReaction: createReactionRateLimit({
        primary: new InMemoryRateLimiter(),
        fallback: new InMemoryRateLimiter(),
        incrementRateLimitHit: deps.metrics.incrementRateLimitHit,
        onStoreError: vi.fn(),
      }),
    });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await expect(handler(request(), houseId, gameId)).resolves.toMatchObject({ status: 200 });
    }
    await expect(handler(request(), houseId, gameId)).resolves.toMatchObject({ status: 429 });
    expect(deps.setGameReaction).toHaveBeenCalledTimes(60);
    expect(deps.metrics.incrementRateLimitHit).toHaveBeenCalledOnce();
  });

  it('[BM-031] rejects an unknown Reaction and a cross-House Member', async () => {
    const invalid = dependencies();
    const invalidResponse = await createGameReactionHandler(invalid)(
      request({ reaction: 'heart' }),
      houseId,
      gameId,
    );
    expect(invalidResponse.status).toBe(422);
    expect(invalid.setGameReaction).not.toHaveBeenCalled();

    const denied = dependencies();
    denied.setGameReaction.mockRejectedValue(
      new HouseAuthorizationDeniedError('not_a_member', true),
    );
    const deniedResponse = await createGameReactionHandler(denied)(request(), houseId, gameId);
    expect(deniedResponse.status).toBe(403);
    expect(denied.metrics.incrementReactionSet).not.toHaveBeenCalled();
  });

  it('[BM-031] keeps a committed Reaction successful when diagnostics fail', async () => {
    const deps = dependencies();
    deps.metrics.incrementReactionSet.mockImplementation(() => {
      throw new Error('metrics unavailable');
    });
    deps.logger.log.mockImplementation(() => {
      throw new Error('logger unavailable');
    });

    const response = await createGameReactionHandler(deps)(request(), houseId, gameId);

    expect(response.status).toBe(200);
    expect(deps.setGameReaction).toHaveBeenCalledOnce();
  });
});
