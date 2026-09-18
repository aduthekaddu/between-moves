import { realtimeTokenHidesRootKey, realtimeTokenResponseSchema } from '@between-moves/contracts';
import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
  type IssuedRealtimeToken,
  type RateLimitResult,
} from '@between-moves/domain';
import { createRealtimeMetricStubs } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter } from '../kernel/rate-limit';
import { createRealtimeTokenRateLimit } from '../kernel/realtime-token-rate-limit';
import {
  createMintRealtimeTokenHandler,
  type NightRealtimeTokenHandlerDependencies,
} from './night-realtime-token-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const gameId = '01941f29-7c00-7000-8000-000000000801';
const serverKey = 'realtime-test-server-key';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};

const issued: IssuedRealtimeToken = {
  token: `${'a'.repeat(32)}.${'b'.repeat(32)}`,
  expiresAt: new Date('2026-09-04T14:15:00.000Z'),
  clientId: viewer.userId,
  publicKey: 'realtime-test-public-key',
  channels: {
    night: 'n'.repeat(22),
    games: [{ gameId, channel: 'g'.repeat(22) }],
  },
  presence: {
    clientId: viewer.userId,
    displayName: viewer.displayName,
    signature: 'presence-signature',
  },
};

function request(origin = 'https://app.example.test') {
  return new Request(
    `https://app.example.test/api/houses/${houseId}/nights/${nightId}/realtime-token`,
    {
      method: 'POST',
      headers: { origin, 'x-request-id': 'bm-037-token' },
    },
  );
}

function dependencies(
  overrides: Partial<NightRealtimeTokenHandlerDependencies> = {},
): NightRealtimeTokenHandlerDependencies {
  return {
    expectedOrigin: 'https://app.example.test',
    realtimeServerKey: serverKey,
    requireViewer: vi.fn(async () => viewer),
    limitRealtimeToken: vi.fn(async (): Promise<RateLimitResult> => ({
      allowed: true,
      retryAfterSeconds: 0,
    })),
    mintRealtimeToken: vi.fn(async () => issued),
    logger: { log: vi.fn() },
    metrics: {
      ...createRealtimeMetricStubs(),
      incrementRealtimeTokenIssue: vi.fn(),
      incrementRateLimitHit: vi.fn(),
    },
    clock: { now: () => new Date('2026-09-04T14:00:00.000Z') },
    ...overrides,
  };
}

describe('BM-037 Realtime token command boundary', () => {
  it('[BM-037] returns a scoped token without the provider root key', async () => {
    const deps = dependencies();
    const response = await createMintRealtimeTokenHandler(deps)(request(), houseId, nightId);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(realtimeTokenResponseSchema.parse(body)).toEqual({
      token: issued.token,
      expiresAt: '2026-09-04T14:15:00.000Z',
      clientId: viewer.userId,
      publicKey: 'realtime-test-public-key',
      channels: issued.channels,
      presence: issued.presence,
    });
    expect(realtimeTokenHidesRootKey(body, serverKey)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(serverKey);
    expect(deps.mintRealtimeToken).toHaveBeenCalledWith({ houseId, nightId, viewer });
    expect(deps.metrics.incrementRealtimeTokenIssue).toHaveBeenCalledOnce();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'realtime.token-issued',
        data: { night_id: nightId, game_count: 1 },
      }),
    );
    expect(JSON.stringify(vi.mocked(deps.logger.log).mock.calls)).not.toContain(issued.token);
    expect(JSON.stringify(vi.mocked(deps.logger.log).mock.calls)).not.toContain(serverKey);
  });

  it('[BM-037] denies a non-member of another Night', async () => {
    const deps = dependencies({
      mintRealtimeToken: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
    });
    const response = await createMintRealtimeTokenHandler(deps)(request(), houseId, nightId);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'forbidden' });
    expect(deps.metrics.incrementRealtimeTokenIssue).not.toHaveBeenCalled();
  });

  it('[BM-037] rejects an invalid Night route before minting', async () => {
    const deps = dependencies();
    const response = await createMintRealtimeTokenHandler(deps)(request(), 'not-a-uuid', nightId);

    expect(response.status).toBe(422);
    expect(deps.requireViewer).not.toHaveBeenCalled();
    expect(deps.mintRealtimeToken).not.toHaveBeenCalled();
  });

  it('[BM-037] rejects invalid origins and unauthenticated requests before minting', async () => {
    const deps = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    const origin = await createMintRealtimeTokenHandler(deps)(
      request('https://evil.example.test'),
      houseId,
      nightId,
    );
    const unauthenticated = await createMintRealtimeTokenHandler(deps)(request(), houseId, nightId);

    expect(origin.status).toBe(403);
    expect(unauthenticated.status).toBe(401);
    expect(deps.mintRealtimeToken).not.toHaveBeenCalled();
  });

  it('[BM-037] maps an unavailable Night without leaking state', async () => {
    const deps = dependencies({
      mintRealtimeToken: vi.fn(async () => {
        throw new DomainError('not_found', 'Night is unavailable');
      }),
    });
    const response = await createMintRealtimeTokenHandler(deps)(request(), houseId, nightId);
    expect(response.status).toBe(404);
  });

  it('[BM-037] [DR-SEC-04] returns 429 at the real account boundary', async () => {
    const deps = dependencies();
    const handler = createMintRealtimeTokenHandler({
      ...deps,
      limitRealtimeToken: createRealtimeTokenRateLimit({
        primary: new InMemoryRateLimiter(),
        fallback: new InMemoryRateLimiter(),
        incrementRateLimitHit: deps.metrics.incrementRateLimitHit,
        onStoreError: vi.fn(),
      }),
    });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await expect(handler(request(), houseId, nightId)).resolves.toMatchObject({ status: 200 });
    }
    const response = await handler(request(), houseId, nightId);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
    expect(deps.mintRealtimeToken).toHaveBeenCalledTimes(30);
    expect(deps.metrics.incrementRateLimitHit).toHaveBeenCalledOnce();
  });
});
