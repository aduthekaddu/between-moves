import {
  AuthenticationRequiredError,
  DomainError,
  HouseAuthorizationDeniedError,
  type AuthenticatedViewer,
} from '@between-moves/domain';
import { createRealtimeMetricStubs } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  createChangeNightPresenceHandler,
  type NightPresenceHandlerDependencies,
} from './night-presence-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const viewer: AuthenticatedViewer = {
  kind: 'authenticated',
  userId: '01941f29-7c00-7000-8000-000000000101',
  displayName: 'Ada',
  imageUrl: null,
};
const command = {
  kind: 'enter' as const,
  token: 't'.repeat(32),
  presence: {
    clientId: viewer.userId,
    displayName: viewer.displayName,
    signature: 'a'.repeat(43),
  },
};

function request(body: unknown = command, origin = 'https://app.example.test'): Request {
  return new Request(`https://app.example.test/api/houses/${houseId}/nights/${nightId}/presence`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-request-id': 'bm-039-presence' },
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides: Partial<NightPresenceHandlerDependencies> = {},
): NightPresenceHandlerDependencies {
  return {
    expectedOrigin: 'https://app.example.test',
    requireViewer: vi.fn(async () => viewer),
    limitPresence: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    changePresence: vi.fn(async () => ({ members: [command.presence] })),
    logger: { log: vi.fn() },
    metrics: createRealtimeMetricStubs(),
    clock: { now: () => new Date('2026-09-04T14:00:00.000Z') },
    ...overrides,
  };
}

describe('Night presence command boundary', () => {
  it('[BM-039] returns signed identities and records the count metric', async () => {
    const deps = dependencies();
    const response = await createChangeNightPresenceHandler(deps)(request(), houseId, nightId);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      presence: [command.presence],
      presenceCount: 1,
    });
    expect(deps.changePresence).toHaveBeenCalledWith({ houseId, nightId, viewer, command });
    expect(deps.metrics.snapshot().presence_count).toBe(1);
  });

  it('[BM-039] rejects bad origin, malformed commands, and unauthenticated viewers', async () => {
    const unauthenticated = dependencies({
      requireViewer: vi.fn(async () => {
        throw new AuthenticationRequiredError();
      }),
    });
    expect(
      (
        await createChangeNightPresenceHandler(unauthenticated)(
          request(command, 'https://evil.example.test'),
          houseId,
          nightId,
        )
      ).status,
    ).toBe(403);
    expect(
      (await createChangeNightPresenceHandler(dependencies())(request({}), houseId, nightId))
        .status,
    ).toBe(422);
    expect(
      (await createChangeNightPresenceHandler(unauthenticated)(request(), houseId, nightId)).status,
    ).toBe(401);
    expect(unauthenticated.changePresence).not.toHaveBeenCalled();
  });

  it('[BM-039] maps forged identity to validation failure', async () => {
    const deps = dependencies({
      changePresence: vi.fn(async () => {
        throw new DomainError('validation_failed', 'Presence identity is invalid');
      }),
    });
    const response = await createChangeNightPresenceHandler(deps)(request(), houseId, nightId);
    expect(response.status).toBe(422);
    expect(deps.metrics.snapshot().presence_count).toBe(0);
  });

  it('[BM-039] rejects command replay above the account or IP limit', async () => {
    const deps = dependencies({
      limitPresence: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 12 })),
    });
    const response = await createChangeNightPresenceHandler(deps)(request(), houseId, nightId);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('12');
    expect(deps.changePresence).not.toHaveBeenCalled();
  });

  it('[BM-039] rejects an oversized command before parsing it', async () => {
    const deps = dependencies();
    const oversized = request({ ...command, token: 't'.repeat(70_000) });
    const response = await createChangeNightPresenceHandler(deps)(oversized, houseId, nightId);

    expect(response.status).toBe(413);
    expect(deps.changePresence).not.toHaveBeenCalled();
  });

  it('[BM-039] rejects invalid route and JSON before changing presence', async () => {
    const deps = dependencies();
    const handler = createChangeNightPresenceHandler(deps);

    await expect(handler(request(), 'not-a-uuid', nightId)).resolves.toMatchObject({ status: 422 });
    await expect(
      handler(
        new Request(`https://app.example.test/api/houses/${houseId}/nights/${nightId}/presence`, {
          method: 'POST',
          headers: {
            origin: 'https://app.example.test',
            'content-type': 'application/json',
          },
          body: '{',
        }),
        houseId,
        nightId,
      ),
    ).resolves.toMatchObject({ status: 422 });
    expect(deps.changePresence).not.toHaveBeenCalled();
  });

  it('[BM-039] maps authorization, missing-night, and unexpected failures', async () => {
    const denied = dependencies({
      changePresence: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
    });
    await expect(
      createChangeNightPresenceHandler(denied)(request(), houseId, nightId),
    ).resolves.toMatchObject({ status: 403 });

    const missing = dependencies({
      changePresence: vi.fn(async () => {
        throw new DomainError('not_found', 'Night is unavailable');
      }),
    });
    await expect(
      createChangeNightPresenceHandler(missing)(request(), houseId, nightId),
    ).resolves.toMatchObject({ status: 404 });

    const unexpected = dependencies({
      changePresence: vi.fn(async () => {
        throw new Error('store unavailable');
      }),
    });
    await expect(
      createChangeNightPresenceHandler(unexpected)(request(), houseId, nightId),
    ).rejects.toThrow('store unavailable');
  });
});
